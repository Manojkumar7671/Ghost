/**
 * IPFS-based Encrypted Swarm Coordination
 *
 * Uses free IPFS services for decentralized swarm coordination:
 * - web3.storage (free tier)
 * - Pinata (1GB free)
 * - Public IPFS gateways
 * - nft.storage (unlimited for NFT data)
 *
 * Features:
 * - Encrypted swarm state synchronization
 * - Content-addressed learning patterns
 * - P2P agent coordination via IPNS
 * - Distributed memory persistence
 */
/**
 * IPFS Provider configuration
 */
export interface IPFSProviderConfig {
    provider: 'web3storage' | 'pinata' | 'infura' | 'filebase' | 'local';
    apiKey?: string;
    apiSecret?: string;
    gateway?: string;
}
/**
 * Encrypted swarm message
 */
export interface EncryptedSwarmMessage {
    cid: string;
    encryptedPayload: string;
    iv: string;
    authTag: string;
    timestamp: number;
    sender: string;
    messageType: SwarmMessageType;
}
/**
 * Swarm message types
 */
export declare enum SwarmMessageType {
    JOIN = "join",
    LEAVE = "leave",
    SYNC_MEMORY = "sync_memory",
    SYNC_LEARNING = "sync_learning",
    CONSENSUS_VOTE = "consensus_vote",
    TASK_DISPATCH = "task_dispatch",
    HEARTBEAT = "heartbeat",
    GOSSIP = "gossip"
}
/**
 * Learning pattern stored on IPFS
 */
export interface IPFSLearningPattern {
    cid: string;
    patternType: string;
    embedding: number[];
    metadata: Record<string, any>;
    timestamp: number;
    agentId: string;
}
/**
 * Swarm state stored on IPFS
 */
export interface IPFSSwarmState {
    swarmId: string;
    agents: Map<string, IPFSAgentInfo>;
    learningPatterns: string[];
    consensusState: ConsensusState;
    lastUpdated: number;
}
/**
 * Agent info for IPFS swarm
 */
export interface IPFSAgentInfo {
    id: string;
    publicKey: string;
    capabilities: string[];
    ipnsKey?: string;
    lastSeen: number;
    status: 'active' | 'idle' | 'disconnected';
}
/**
 * Consensus state
 */
export interface ConsensusState {
    proposalId: string;
    votes: Map<string, boolean>;
    threshold: number;
    deadline: number;
}
/**
 * Encryption utilities for swarm communication
 */
declare class SwarmEncryption {
    private algorithm;
    /**
     * Generate a new encryption key
     */
    generateKey(): Buffer;
    /**
     * Derive shared key from agent keys (simplified ECDH)
     */
    deriveSharedKey(privateKey: Buffer, publicKey: Buffer): Buffer;
    /**
     * Encrypt data with AES-256-GCM
     */
    encrypt(data: string, key: Buffer): {
        encrypted: string;
        iv: string;
        authTag: string;
    };
    /**
     * Decrypt data with AES-256-GCM
     */
    decrypt(encrypted: string, key: Buffer, iv: string, authTag: string): string;
    /**
     * Generate key pair for agent
     */
    generateKeyPair(): {
        publicKey: string;
        privateKey: string;
    };
    /**
     * Sign data
     */
    sign(data: string, privateKey: string): string;
    /**
     * Verify signature
     */
    verify(data: string, signature: string, publicKey: string): boolean;
}
/**
 * IPFS Client for free providers
 */
declare class IPFSClient {
    private gateway;
    private apiEndpoint?;
    private apiKey?;
    private apiSecret?;
    constructor(config: IPFSProviderConfig);
    /**
     * Add data to IPFS (simulated for demo, real impl would use actual API)
     */
    add(data: string | Buffer): Promise<string>;
    /**
     * Get data from IPFS via gateway
     */
    get(cid: string): Promise<string>;
    /**
     * Pin data to IPFS (persistent storage)
     */
    pin(cid: string): Promise<boolean>;
    /**
     * Get gateway URL
     */
    getGatewayUrl(cid: string): string;
}
/**
 * IPFS-based Encrypted Swarm Coordinator
 */
export declare class IPFSSwarmCoordinator {
    private ipfs;
    private encryption;
    private swarmKey;
    private agents;
    private learningPatterns;
    private messageLog;
    private swarmId;
    constructor(config: IPFSProviderConfig, swarmKey?: Buffer);
    /**
     * Initialize swarm and publish initial state to IPFS
     */
    initialize(): Promise<string>;
    /**
     * Register agent with encrypted credentials
     */
    registerAgent(agentId: string, capabilities: string[]): Promise<{
        publicKey: string;
        privateKey: string;
    }>;
    /**
     * Publish encrypted message to IPFS
     */
    publishMessage(payload: Record<string, any>, messageType?: SwarmMessageType): Promise<EncryptedSwarmMessage>;
    /**
     * Retrieve and decrypt message from IPFS
     */
    retrieveMessage(message: EncryptedSwarmMessage): Promise<Record<string, any>>;
    /**
     * Store learning pattern on IPFS
     */
    storeLearningPattern(agentId: string, patternType: string, embedding: number[], metadata?: Record<string, any>): Promise<IPFSLearningPattern>;
    /**
     * Retrieve learning pattern from IPFS
     */
    retrieveLearningPattern(cid: string): Promise<IPFSLearningPattern | null>;
    /**
     * Sync memory vectors across swarm via IPFS
     */
    syncMemory(agentId: string, vectors: number[][], namespace: string): Promise<string>;
    /**
     * Sync learning state across swarm
     */
    syncLearning(agentId: string, qTable: number[][], policyWeights: number[]): Promise<string>;
    /**
     * Run consensus vote via IPFS
     */
    submitConsensusVote(agentId: string, proposalId: string, vote: boolean, privateKey: string): Promise<string>;
    /**
     * Gossip propagation via IPFS
     */
    gossip(origin: string, payload: Record<string, any>, ttl?: number): Promise<string[]>;
    /**
     * Get swarm statistics
     */
    getStats(): {
        swarmId: string;
        activeAgents: number;
        totalAgents: number;
        learningPatterns: number;
        messageCount: number;
        lastActivity: number;
    };
    /**
     * Export swarm state to IPFS (for backup/recovery)
     */
    exportState(): Promise<string>;
    /**
     * Get swarm key (for sharing with authorized agents)
     */
    getSwarmKey(): string;
    /**
     * Get all message CIDs (for IPFS-based message history)
     */
    getMessageHistory(): EncryptedSwarmMessage[];
}
/**
 * Free IPFS provider presets
 */
export declare const FREE_IPFS_PROVIDERS: {
    /**
     * web3.storage - 5GB free
     * Sign up: https://web3.storage
     */
    web3storage: (apiKey: string) => IPFSProviderConfig;
    /**
     * Pinata - 1GB free
     * Sign up: https://pinata.cloud
     */
    pinata: (apiKey: string, apiSecret: string) => IPFSProviderConfig;
    /**
     * Public gateway (no API key needed, read-only)
     */
    public: () => IPFSProviderConfig;
    /**
     * Cloudflare IPFS (free, fast)
     */
    cloudflare: () => IPFSProviderConfig;
    /**
     * 4everland (free tier)
     */
    foureverland: (apiKey?: string) => IPFSProviderConfig;
};
export { SwarmEncryption, IPFSClient };
//# sourceMappingURL=ipfs-swarm.d.ts.map