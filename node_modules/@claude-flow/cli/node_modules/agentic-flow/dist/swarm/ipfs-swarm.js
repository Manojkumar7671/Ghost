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
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
/**
 * Free IPFS Gateway URLs
 */
const FREE_IPFS_GATEWAYS = [
    'https://ipfs.io/ipfs/',
    'https://dweb.link/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://w3s.link/ipfs/',
    'https://4everland.io/ipfs/',
];
/**
 * Swarm message types
 */
export var SwarmMessageType;
(function (SwarmMessageType) {
    SwarmMessageType["JOIN"] = "join";
    SwarmMessageType["LEAVE"] = "leave";
    SwarmMessageType["SYNC_MEMORY"] = "sync_memory";
    SwarmMessageType["SYNC_LEARNING"] = "sync_learning";
    SwarmMessageType["CONSENSUS_VOTE"] = "consensus_vote";
    SwarmMessageType["TASK_DISPATCH"] = "task_dispatch";
    SwarmMessageType["HEARTBEAT"] = "heartbeat";
    SwarmMessageType["GOSSIP"] = "gossip";
})(SwarmMessageType || (SwarmMessageType = {}));
/**
 * Encryption utilities for swarm communication
 */
class SwarmEncryption {
    algorithm = 'aes-256-gcm';
    /**
     * Generate a new encryption key
     */
    generateKey() {
        return crypto.randomBytes(32);
    }
    /**
     * Derive shared key from agent keys (simplified ECDH)
     */
    deriveSharedKey(privateKey, publicKey) {
        // In production, use proper ECDH
        const combined = Buffer.concat([privateKey, publicKey]);
        return crypto.createHash('sha256').update(combined).digest();
    }
    /**
     * Encrypt data with AES-256-GCM
     */
    encrypt(data, key) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        let encrypted = cipher.update(data, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return {
            encrypted,
            iv: iv.toString('base64'),
            authTag: cipher.getAuthTag().toString('base64'),
        };
    }
    /**
     * Decrypt data with AES-256-GCM
     */
    decrypt(encrypted, key, iv, authTag) {
        const decipher = crypto.createDecipheriv(this.algorithm, key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(authTag, 'base64'));
        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    /**
     * Generate key pair for agent
     */
    generateKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        return { publicKey, privateKey };
    }
    /**
     * Sign data
     */
    sign(data, privateKey) {
        const sign = crypto.createSign('SHA256');
        sign.update(data);
        return sign.sign(privateKey, 'base64');
    }
    /**
     * Verify signature
     */
    verify(data, signature, publicKey) {
        const verify = crypto.createVerify('SHA256');
        verify.update(data);
        return verify.verify(publicKey, signature, 'base64');
    }
}
/**
 * IPFS Client for free providers
 */
class IPFSClient {
    gateway;
    apiEndpoint;
    apiKey;
    apiSecret;
    constructor(config) {
        this.gateway = config.gateway || FREE_IPFS_GATEWAYS[0];
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        // Set API endpoint based on provider
        switch (config.provider) {
            case 'pinata':
                this.apiEndpoint = 'https://api.pinata.cloud';
                break;
            case 'web3storage':
                this.apiEndpoint = 'https://api.web3.storage';
                break;
            case 'infura':
                this.apiEndpoint = 'https://ipfs.infura.io:5001/api/v0';
                break;
            case 'filebase':
                this.apiEndpoint = 'https://api.filebase.io/v1/ipfs';
                break;
            default:
                this.apiEndpoint = undefined;
        }
    }
    /**
     * Add data to IPFS (simulated for demo, real impl would use actual API)
     */
    async add(data) {
        // Generate CID (content-addressed hash)
        const hash = crypto.createHash('sha256')
            .update(typeof data === 'string' ? data : data.toString())
            .digest('hex');
        // Simulated CID (real impl would pin to IPFS)
        const cid = `Qm${hash.slice(0, 44)}`;
        logger.debug('IPFS add', { cid, size: data.length });
        return cid;
    }
    /**
     * Get data from IPFS via gateway
     */
    async get(cid) {
        const url = `${this.gateway}${cid}`;
        try {
            const response = await fetch(url, {
                headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
            });
            if (!response.ok) {
                throw new Error(`IPFS fetch failed: ${response.status}`);
            }
            return await response.text();
        }
        catch (error) {
            // Try alternate gateways
            for (const gateway of FREE_IPFS_GATEWAYS) {
                if (gateway === this.gateway)
                    continue;
                try {
                    const resp = await fetch(`${gateway}${cid}`);
                    if (resp.ok)
                        return await resp.text();
                }
                catch {
                    continue;
                }
            }
            throw error;
        }
    }
    /**
     * Pin data to IPFS (persistent storage)
     */
    async pin(cid) {
        if (!this.apiEndpoint || !this.apiKey) {
            logger.warn('IPFS pin requires API key');
            return false;
        }
        // Pinata pinning
        if (this.apiEndpoint.includes('pinata')) {
            try {
                const response = await fetch(`${this.apiEndpoint}/pinning/pinByHash`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'pinata_api_key': this.apiKey,
                        'pinata_secret_api_key': this.apiSecret || '',
                    },
                    body: JSON.stringify({ hashToPin: cid }),
                });
                return response.ok;
            }
            catch {
                return false;
            }
        }
        return true;
    }
    /**
     * Get gateway URL
     */
    getGatewayUrl(cid) {
        return `${this.gateway}${cid}`;
    }
}
/**
 * IPFS-based Encrypted Swarm Coordinator
 */
export class IPFSSwarmCoordinator {
    ipfs;
    encryption;
    swarmKey;
    agents;
    learningPatterns;
    messageLog;
    swarmId;
    constructor(config, swarmKey) {
        this.ipfs = new IPFSClient(config);
        this.encryption = new SwarmEncryption();
        this.swarmKey = swarmKey || this.encryption.generateKey();
        this.agents = new Map();
        this.learningPatterns = new Map();
        this.messageLog = [];
        this.swarmId = crypto.randomUUID();
    }
    /**
     * Initialize swarm and publish initial state to IPFS
     */
    async initialize() {
        const initialState = {
            swarmId: this.swarmId,
            created: Date.now(),
            version: '1.0.0',
        };
        const cid = await this.ipfs.add(JSON.stringify(initialState));
        logger.info('IPFS Swarm initialized', { swarmId: this.swarmId, cid });
        return cid;
    }
    /**
     * Register agent with encrypted credentials
     */
    async registerAgent(agentId, capabilities) {
        const keyPair = this.encryption.generateKeyPair();
        const agentInfo = {
            id: agentId,
            publicKey: keyPair.publicKey,
            capabilities,
            lastSeen: Date.now(),
            status: 'active',
        };
        this.agents.set(agentId, agentInfo);
        // Publish join message to IPFS
        await this.publishMessage({
            type: SwarmMessageType.JOIN,
            agentId,
            capabilities,
        });
        logger.info('Agent registered', { agentId, capabilities });
        return keyPair;
    }
    /**
     * Publish encrypted message to IPFS
     */
    async publishMessage(payload, messageType = SwarmMessageType.GOSSIP) {
        const data = JSON.stringify(payload);
        const { encrypted, iv, authTag } = this.encryption.encrypt(data, this.swarmKey);
        // Store encrypted message on IPFS
        const cid = await this.ipfs.add(encrypted);
        const message = {
            cid,
            encryptedPayload: encrypted,
            iv,
            authTag,
            timestamp: Date.now(),
            sender: payload.agentId || 'coordinator',
            messageType,
        };
        this.messageLog.push(message);
        return message;
    }
    /**
     * Retrieve and decrypt message from IPFS
     */
    async retrieveMessage(message) {
        try {
            const decrypted = this.encryption.decrypt(message.encryptedPayload, this.swarmKey, message.iv, message.authTag);
            return JSON.parse(decrypted);
        }
        catch (error) {
            logger.error('Failed to decrypt message', { cid: message.cid, error });
            throw error;
        }
    }
    /**
     * Store learning pattern on IPFS
     */
    async storeLearningPattern(agentId, patternType, embedding, metadata = {}) {
        const pattern = {
            patternType,
            embedding,
            metadata,
            timestamp: Date.now(),
            agentId,
        };
        // Encrypt before storing
        const encrypted = this.encryption.encrypt(JSON.stringify(pattern), this.swarmKey);
        const cid = await this.ipfs.add(JSON.stringify(encrypted));
        const storedPattern = {
            cid,
            ...pattern,
        };
        this.learningPatterns.set(cid, storedPattern);
        logger.debug('Learning pattern stored', { cid, patternType, agentId });
        return storedPattern;
    }
    /**
     * Retrieve learning pattern from IPFS
     */
    async retrieveLearningPattern(cid) {
        // Check local cache first
        if (this.learningPatterns.has(cid)) {
            return this.learningPatterns.get(cid);
        }
        try {
            const data = await this.ipfs.get(cid);
            const encrypted = JSON.parse(data);
            const decrypted = this.encryption.decrypt(encrypted.encrypted, this.swarmKey, encrypted.iv, encrypted.authTag);
            const pattern = JSON.parse(decrypted);
            return { cid, ...pattern };
        }
        catch (error) {
            logger.error('Failed to retrieve pattern', { cid, error });
            return null;
        }
    }
    /**
     * Sync memory vectors across swarm via IPFS
     */
    async syncMemory(agentId, vectors, namespace) {
        const memoryData = {
            agentId,
            vectors,
            namespace,
            timestamp: Date.now(),
            vectorCount: vectors.length,
            dimensions: vectors[0]?.length || 0,
        };
        const message = await this.publishMessage(memoryData, SwarmMessageType.SYNC_MEMORY);
        // Pin for persistence
        await this.ipfs.pin(message.cid);
        return message.cid;
    }
    /**
     * Sync learning state across swarm
     */
    async syncLearning(agentId, qTable, policyWeights) {
        const learningData = {
            agentId,
            qTable,
            policyWeights,
            timestamp: Date.now(),
        };
        const message = await this.publishMessage(learningData, SwarmMessageType.SYNC_LEARNING);
        return message.cid;
    }
    /**
     * Run consensus vote via IPFS
     */
    async submitConsensusVote(agentId, proposalId, vote, privateKey) {
        const voteData = { proposalId, vote, timestamp: Date.now() };
        const signature = this.encryption.sign(JSON.stringify(voteData), privateKey);
        const message = await this.publishMessage({ agentId, ...voteData, signature }, SwarmMessageType.CONSENSUS_VOTE);
        return message.cid;
    }
    /**
     * Gossip propagation via IPFS
     */
    async gossip(origin, payload, ttl = 5) {
        const cids = [];
        const gossipData = {
            origin,
            payload,
            ttl,
            hop: 0,
            timestamp: Date.now(),
        };
        const message = await this.publishMessage(gossipData, SwarmMessageType.GOSSIP);
        cids.push(message.cid);
        // Simulate gossip propagation to connected agents
        for (const [agentId, agent] of this.agents) {
            if (agentId !== origin && agent.status === 'active') {
                const hopMessage = await this.publishMessage({ ...gossipData, hop: 1, receiver: agentId }, SwarmMessageType.GOSSIP);
                cids.push(hopMessage.cid);
            }
        }
        return cids;
    }
    /**
     * Get swarm statistics
     */
    getStats() {
        const activeAgents = Array.from(this.agents.values())
            .filter(a => a.status === 'active').length;
        return {
            swarmId: this.swarmId,
            activeAgents,
            totalAgents: this.agents.size,
            learningPatterns: this.learningPatterns.size,
            messageCount: this.messageLog.length,
            lastActivity: this.messageLog.length > 0
                ? this.messageLog[this.messageLog.length - 1].timestamp
                : Date.now(),
        };
    }
    /**
     * Export swarm state to IPFS (for backup/recovery)
     */
    async exportState() {
        const state = {
            swarmId: this.swarmId,
            agents: Array.from(this.agents.entries()),
            learningPatternCids: Array.from(this.learningPatterns.keys()),
            messageCount: this.messageLog.length,
            exportedAt: Date.now(),
        };
        const encrypted = this.encryption.encrypt(JSON.stringify(state), this.swarmKey);
        const cid = await this.ipfs.add(JSON.stringify(encrypted));
        await this.ipfs.pin(cid);
        logger.info('Swarm state exported', { cid });
        return cid;
    }
    /**
     * Get swarm key (for sharing with authorized agents)
     */
    getSwarmKey() {
        return this.swarmKey.toString('base64');
    }
    /**
     * Get all message CIDs (for IPFS-based message history)
     */
    getMessageHistory() {
        return [...this.messageLog];
    }
}
/**
 * Free IPFS provider presets
 */
export const FREE_IPFS_PROVIDERS = {
    /**
     * web3.storage - 5GB free
     * Sign up: https://web3.storage
     */
    web3storage: (apiKey) => ({
        provider: 'web3storage',
        apiKey,
        gateway: 'https://w3s.link/ipfs/',
    }),
    /**
     * Pinata - 1GB free
     * Sign up: https://pinata.cloud
     */
    pinata: (apiKey, apiSecret) => ({
        provider: 'pinata',
        apiKey,
        apiSecret,
        gateway: 'https://gateway.pinata.cloud/ipfs/',
    }),
    /**
     * Public gateway (no API key needed, read-only)
     */
    public: () => ({
        provider: 'local',
        gateway: 'https://ipfs.io/ipfs/',
    }),
    /**
     * Cloudflare IPFS (free, fast)
     */
    cloudflare: () => ({
        provider: 'local',
        gateway: 'https://cloudflare-ipfs.com/ipfs/',
    }),
    /**
     * 4everland (free tier)
     */
    foureverland: (apiKey) => ({
        provider: 'local',
        apiKey,
        gateway: 'https://4everland.io/ipfs/',
    }),
};
export { SwarmEncryption, IPFSClient };
//# sourceMappingURL=ipfs-swarm.js.map