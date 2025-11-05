pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecretMessage is ZamaEthereumConfig {
    struct EncryptedMessage {
        euint32 encryptedContent;
        uint256 expirationTime;
        bool isBurnAfterReading;
        bool isDecrypted;
        address sender;
        uint256 timestamp;
        string condition;
        uint32 decryptedContent;
    }

    mapping(string => EncryptedMessage) public encryptedMessages;
    string[] public messageIds;

    event MessageSent(string indexed messageId, address indexed sender);
    event MessageDecrypted(string indexed messageId, uint32 decryptedContent);
    event MessageBurned(string indexed messageId);

    constructor() ZamaEthereumConfig() {
    }

    function sendMessage(
        string calldata messageId,
        externalEuint32 encryptedContent,
        bytes calldata inputProof,
        uint256 expirationTime,
        bool isBurnAfterReading,
        string calldata condition
    ) external {
        require(bytes(encryptedMessages[messageId].condition).length == 0, "Message ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, inputProof)), "Invalid encrypted content");

        encryptedMessages[messageId] = EncryptedMessage({
            encryptedContent: FHE.fromExternal(encryptedContent, inputProof),
            expirationTime: expirationTime,
            isBurnAfterReading: isBurnAfterReading,
            isDecrypted: false,
            sender: msg.sender,
            timestamp: block.timestamp,
            condition: condition,
            decryptedContent: 0
        });

        FHE.allowThis(encryptedMessages[messageId].encryptedContent);
        FHE.makePubliclyDecryptable(encryptedMessages[messageId].encryptedContent);

        messageIds.push(messageId);
        emit MessageSent(messageId, msg.sender);
    }

    function decryptMessage(
        string calldata messageId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(encryptedMessages[messageId].condition).length > 0, "Message does not exist");
        require(!encryptedMessages[messageId].isDecrypted, "Message already decrypted");
        require(block.timestamp <= encryptedMessages[messageId].expirationTime, "Message expired");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedMessages[messageId].encryptedContent);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        encryptedMessages[messageId].decryptedContent = decodedValue;
        encryptedMessages[messageId].isDecrypted = true;

        if (encryptedMessages[messageId].isBurnAfterReading) {
            delete encryptedMessages[messageId];
            emit MessageBurned(messageId);
        } else {
            emit MessageDecrypted(messageId, decodedValue);
        }
    }

    function getMessage(string calldata messageId) external view returns (
        uint256 expirationTime,
        bool isBurnAfterReading,
        bool isDecrypted,
        address sender,
        uint256 timestamp,
        string memory condition,
        uint32 decryptedContent
    ) {
        require(bytes(encryptedMessages[messageId].condition).length > 0, "Message does not exist");
        EncryptedMessage storage message = encryptedMessages[messageId];

        return (
            message.expirationTime,
            message.isBurnAfterReading,
            message.isDecrypted,
            message.sender,
            message.timestamp,
            message.condition,
            message.decryptedContent
        );
    }

    function getAllMessageIds() external view returns (string[] memory) {
        return messageIds;
    }

    function getEncryptedContent(string calldata messageId) external view returns (euint32) {
        require(bytes(encryptedMessages[messageId].condition).length > 0, "Message does not exist");
        return encryptedMessages[messageId].encryptedContent;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


