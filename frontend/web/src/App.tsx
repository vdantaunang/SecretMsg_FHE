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
  decryptedValue: number;
  isVerified: boolean;
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
  const [searchTerm, setSearchTerm] = useState("");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, verified: 0, today: 0 });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
        addToHistory("FHEVM initialized successfully");
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
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

  const addToHistory = (action: string) => {
    setOperationHistory(prev => [`${new Date().toLocaleTimeString()}: ${action}`, ...prev.slice(0, 9)]);
  };

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
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setMessages(messagesList);
      
      const today = messagesList.filter(msg => 
        new Date(msg.timestamp * 1000).toDateString() === new Date().toDateString()
      ).length;
      
      setStats({
        total: messagesList.length,
        verified: messagesList.filter(msg => msg.isVerified).length,
        today
      });
      
      addToHistory(`Loaded ${messagesList.length} secret messages`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const callIsAvailable = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      addToHistory("Checked contract availability - Success");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createMessage = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMessage(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting message with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const messageValue = parseInt(newMessageData.message) || 0;
      const businessId = `secret-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, messageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newMessageData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        messageValue,
        0,
        newMessageData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted message..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Secret message created!" });
      addToHistory(`Created secret message: ${newMessageData.name}`);
      
      await loadData();
      setShowCreateModal(false);
      setNewMessageData({ name: "", message: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMessage(false); 
    }
  };

  const decryptMessage = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Message already verified" });
        addToHistory(`Viewed verified message: ${storedValue}`);
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Message decrypted successfully!" });
      addToHistory(`Decrypted message: ${clearValue}`);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Message already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredMessages = messages.filter(msg =>
    msg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    msg.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    msg.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔥 Secret Messages FHE</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Continue</h2>
            <p>Connect your wallet to start sending and receiving encrypted secret messages with FHE protection.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start secure messaging</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
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
          <h1>🔥 Secret Messages FHE</h1>
          <p>End-to-end encrypted messaging with homomorphic encryption</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="status-btn">
            Check Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Secret
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Messages</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.today}</div>
            <div className="stat-label">Today</div>
          </div>
        </div>
        
        <div className="search-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search messages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "↻"}
            </button>
          </div>
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
              <MessageCard
                key={index}
                message={message}
                onSelect={setSelectedMessage}
                onDecrypt={decryptMessage}
                isDecrypting={fheIsDecrypting}
              />
            ))
          )}
        </div>
        
        <div className="history-section">
          <h3>Recent Activity</h3>
          <div className="history-list">
            {operationHistory.map((action, index) => (
              <div key={index} className="history-item">
                {action}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateMessageModal
          onSubmit={createMessage}
          onClose={() => setShowCreateModal(false)}
          creating={creatingMessage}
          messageData={newMessageData}
          setMessageData={setNewMessageData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedMessage && (
        <MessageDetailModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onDecrypt={decryptMessage}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const MessageCard: React.FC<{
  message: SecretMessage;
  onSelect: (message: SecretMessage) => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ message, onSelect, onDecrypt, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (localDecrypted !== null) {
      setLocalDecrypted(null);
      return;
    }
    const result = await onDecrypt(message.id);
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="message-card" onClick={() => onSelect(message)}>
      <div className="card-header">
        <h3>{message.name}</h3>
        <span className={`status ${message.isVerified ? 'verified' : 'encrypted'}`}>
          {message.isVerified ? '✅' : '🔒'}
        </span>
      </div>
      
      <div className="card-content">
        <p>{message.description}</p>
        <div className="message-meta">
          <span>From: {message.creator.substring(0, 6)}...{message.creator.substring(38)}</span>
          <span>{new Date(message.timestamp * 1000).toLocaleDateString()}</span>
        </div>
      </div>
      
      <div className="card-actions">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            handleDecrypt();
          }}
          className={`decrypt-btn ${message.isVerified || localDecrypted ? 'decrypted' : ''}`}
          disabled={isDecrypting}
        >
          {isDecrypting ? "🔓..." : message.isVerified ? "✅ Verified" : localDecrypted ? "🔄 Hide" : "🔓 Decrypt"}
        </button>
        
        {(message.isVerified || localDecrypted) && (
          <div className="decrypted-value">
            Message: {message.isVerified ? message.decryptedValue : localDecrypted}
          </div>
        )}
      </div>
    </div>
  );
};

const CreateMessageModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  messageData: any;
  setMessageData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, messageData, setMessageData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'message') {
      const intValue = value.replace(/[^\d]/g, '');
      setMessageData({ ...messageData, [name]: intValue });
    } else {
      setMessageData({ ...messageData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>New Secret Message</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Your message will be encrypted with homomorphic encryption (integer numbers only)</p>
          </div>
          
          <div className="form-group">
            <label>Message Title *</label>
            <input 
              type="text" 
              name="name" 
              value={messageData.name} 
              onChange={handleChange} 
              placeholder="Enter message title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Secret Number (Integer only) *</label>
            <input 
              type="number" 
              name="message" 
              value={messageData.message} 
              onChange={handleChange} 
              placeholder="Enter your secret number..." 
              step="1"
              min="0"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={messageData.description} 
              onChange={handleChange} 
              placeholder="Optional description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !messageData.name || !messageData.message} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Secret"}
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageDetailModal: React.FC<{
  message: SecretMessage;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ message, onClose, onDecrypt, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await onDecrypt(message.id);
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Message Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="message-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{message.name}</strong>
            </div>
            <div className="info-row">
              <span>From:</span>
              <strong>{message.creator}</strong>
            </div>
            <div className="info-row">
              <span>Date:</span>
              <strong>{new Date(message.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Description:</span>
              <p>{message.description}</p>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>Encryption Status</h3>
            <div className="status-display">
              <div className={`status-badge ${message.isVerified ? 'verified' : 'encrypted'}`}>
                {message.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
              </div>
              
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting || message.isVerified}
                className="decrypt-btn large"
              >
                {isDecrypting ? "Decrypting..." : message.isVerified ? "Already Verified" : "Decrypt Message"}
              </button>
            </div>
            
            {(message.isVerified || localDecrypted) && (
              <div className="decrypted-content">
                <h4>Decrypted Message:</h4>
                <div className="secret-number">
                  {message.isVerified ? message.decryptedValue : localDecrypted}
                </div>
                <p className="verification-note">
                  {message.isVerified 
                    ? "This value has been verified on-chain using FHE signatures"
                    : "This is a local decryption - verify on-chain to make it permanent"
                  }
                </p>
              </div>
            )}
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


