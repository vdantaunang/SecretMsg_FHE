import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SecretMessage {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<SecretMessage[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingMessage, setCreatingMessage] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newMessageData, setNewMessageData] = useState({ name: "", message: "", description: "" });
  const [selectedMessage, setSelectedMessage] = useState<SecretMessage | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const messagesList: SecretMessage[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          messagesList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: "",
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setMessages(messagesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createMessage = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMessage(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting message with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const messageValue = parseInt(newMessageData.message) || 0;
      const businessId = `msg-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, messageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newMessageData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newMessageData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Secret message created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewMessageData({ name: "", message: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMessage(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Message already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Message decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Message is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredMessages = messages.filter(message => {
    const matchesSearch = message.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         message.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || message.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: messages.length,
    verified: messages.filter(m => m.isVerified).length,
    recent: messages.filter(m => Date.now()/1000 - m.timestamp < 60 * 60 * 24).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SecretMsg FHE 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💬</div>
            <h2>Connect to Secret Messages</h2>
            <p>Connect your wallet to start sending and receiving encrypted secret messages with FHE protection.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secret messages...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SecretMsg FHE 💬</h1>
          <p>Encrypted messages with FHE protection</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Status
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Secret Message
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-item">
            <span className="stat-number">{stats.total}</span>
            <span className="stat-label">Total Messages</span>
          </div>
          <div className="stat-item">
            <span className="stat-number">{stats.verified}</span>
            <span className="stat-label">Verified</span>
          </div>
          <div className="stat-item">
            <span className="stat-number">{stats.recent}</span>
            <span className="stat-label">Today</span>
          </div>
        </div>

        <div className="controls-panel">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search messages..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Show verified only
            </label>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="messages-grid">
          {filteredMessages.length === 0 ? (
            <div className="no-messages">
              <p>No secret messages found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Message
              </button>
            </div>
          ) : (
            filteredMessages.map((message, index) => (
              <div 
                className={`message-card ${message.isVerified ? 'verified' : ''}`}
                key={index}
                onClick={() => setSelectedMessage(message)}
              >
                <div className="message-header">
                  <h3>{message.name}</h3>
                  <span className={`status ${message.isVerified ? 'verified' : 'encrypted'}`}>
                    {message.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
                <p className="message-preview">{message.description}</p>
                <div className="message-meta">
                  <span>From: {message.creator.substring(0, 6)}...{message.creator.substring(38)}</span>
                  <span>{new Date(message.timestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Secret Message</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Encryption</strong>
                <p>Your message will be encrypted with Zama FHE (Integer values only)</p>
              </div>
              
              <div className="form-group">
                <label>Message Title *</label>
                <input 
                  type="text" 
                  value={newMessageData.name}
                  onChange={(e) => setNewMessageData({...newMessageData, name: e.target.value})}
                  placeholder="Enter message title..."
                />
              </div>
              
              <div className="form-group">
                <label>Secret Number (Integer) *</label>
                <input 
                  type="number" 
                  value={newMessageData.message}
                  onChange={(e) => setNewMessageData({...newMessageData, message: e.target.value})}
                  placeholder="Enter secret number..."
                  step="1"
                />
                <div className="input-hint">FHE Encrypted Integer</div>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text" 
                  value={newMessageData.description}
                  onChange={(e) => setNewMessageData({...newMessageData, description: e.target.value})}
                  placeholder="Enter description..."
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createMessage}
                disabled={creatingMessage || isEncrypting || !newMessageData.name || !newMessageData.message}
                className="submit-btn"
              >
                {creatingMessage || isEncrypting ? "Encrypting..." : "Create Secret Message"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedMessage && (
        <MessageDetailModal 
          message={selectedMessage}
          onClose={() => {
            setSelectedMessage(null);
            setDecryptedContent(null);
          }}
          decryptedContent={decryptedContent}
          isDecrypting={isDecrypting || fheIsDecrypting}
          onDecrypt={async () => {
            const content = await decryptData(selectedMessage.id);
            setDecryptedContent(content);
          }}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <span>✓</span>}
            {transactionStatus.status === "error" && <span>✗</span>}
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>SecretMsg FHE - Encrypted messaging with fully homomorphic encryption</p>
      </footer>
    </div>
  );
};

const MessageDetailModal: React.FC<{
  message: SecretMessage;
  onClose: () => void;
  decryptedContent: number | null;
  isDecrypting: boolean;
  onDecrypt: () => Promise<void>;
}> = ({ message, onClose, decryptedContent, isDecrypting, onDecrypt }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Secret Message Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="message-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{message.name}</strong>
            </div>
            <div className="info-row">
              <span>From:</span>
              <strong>{message.creator.substring(0, 6)}...{message.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Date:</span>
              <strong>{new Date(message.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Description:</span>
              <span>{message.description}</span>
            </div>
          </div>
          
          <div className="encrypted-content">
            <h3>Encrypted Content</h3>
            <div className="content-box">
              {message.isVerified ? (
                <div className="decrypted-message">
                  <span className="decrypted-value">Decrypted Number: {message.decryptedValue}</span>
                  <span className="verification-badge">✅ On-chain Verified</span>
                </div>
              ) : decryptedContent !== null ? (
                <div className="decrypted-message">
                  <span className="decrypted-value">Decrypted Number: {decryptedContent}</span>
                  <span className="verification-badge">🔓 Locally Decrypted</span>
                </div>
              ) : (
                <div className="encrypted-message">
                  <span className="encrypted-label">🔒 FHE Encrypted Integer</span>
                  <p>Content is encrypted using Zama FHE technology</p>
                </div>
              )}
            </div>
            
            <button 
              className={`decrypt-btn ${message.isVerified || decryptedContent !== null ? 'decrypted' : ''}`}
              onClick={onDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : 
               message.isVerified ? "✅ Verified" :
               decryptedContent !== null ? "🔄 Re-verify" :
               "🔓 Decrypt Message"}
            </button>
          </div>
          
          <div className="fhe-explanation">
            <h4>FHE Protection Process</h4>
            <div className="process-steps">
              <div className="step">
                <span>1</span>
                <p>Message encrypted client-side with FHE</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Encrypted data stored on blockchain</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Authorized decryption with zero-knowledge proof</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;