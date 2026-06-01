/**
 * Real P2P Swarm Coordination
 *
 * IMPROVED VERSION with actual P2P connections:
 * - Real GunDB relay connections
 * - Actual WebRTC via PeerJS
 * - Persistent learning storage
 * - Better error handling
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
// Lazy-load P2P modules
let Gun = null;
let Peer = null;
/**
 * Load GunDB (lazy)
 */
async function getGun() {
    if (!Gun) {
        try {
            Gun = (await import('gun')).default;
        }
        catch {
            logger.warn('GunDB not installed. Run: npm install gun');
            return null;
        }
    }
    return Gun;
}
/**
 * Load PeerJS (lazy)
 */
async function getPeer() {
    if (!Peer) {
        try {
            const peerjs = await import('peerjs');
            Peer = peerjs.Peer || peerjs.default;
        }
        catch {
            logger.warn('PeerJS not installed. Run: npm install peerjs');
            return null;
        }
    }
    return Peer;
}
/**
 * Encryption utilities
 */
class SwarmCrypto {
    algorithm = 'aes-256-gcm';
    generateKey() {
        return crypto.randomBytes(32).toString('base64');
    }
    encrypt(data, keyBase64) {
        const key = Buffer.from(keyBase64, 'base64');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        let ciphertext = cipher.update(data, 'utf8', 'base64');
        ciphertext += cipher.final('base64');
        return {
            ciphertext,
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
        };
    }
    decrypt(ciphertext, keyBase64, ivBase64, tagBase64) {
        const key = Buffer.from(keyBase64, 'base64');
        const iv = Buffer.from(ivBase64, 'base64');
        const tag = Buffer.from(tagBase64, 'base64');
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(tag);
        let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
        plaintext += decipher.final('utf8');
        return plaintext;
    }
    hash(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
}
/**
 * Real GunDB Swarm (connects to actual relays)
 */
export class RealGunDBSwarm {
    gun = null;
    swarmNode = null;
    crypto;
    swarmKey;
    swarmId;
    connected = false;
    static FREE_RELAYS = [
        'https://gun-manhattan.herokuapp.com/gun',
        'https://gun-us.herokuapp.com/gun',
        'https://gun-eu.herokuapp.com/gun',
    ];
    constructor(swarmKey, relays) {
        this.crypto = new SwarmCrypto();
        this.swarmKey = swarmKey || this.crypto.generateKey();
        this.swarmId = this.crypto.hash(this.swarmKey).slice(0, 16);
    }
    /**
     * Connect to GunDB relays
     */
    async connect(relays) {
        const GunDB = await getGun();
        if (!GunDB) {
            logger.warn('GunDB not available, using simulation mode');
            return false;
        }
        try {
            this.gun = GunDB(relays || RealGunDBSwarm.FREE_RELAYS);
            this.swarmNode = this.gun.get(`agentic-flow-swarm-${this.swarmId}`);
            this.connected = true;
            logger.info('Connected to GunDB relays', {
                swarmId: this.swarmId,
                relays: relays?.length || RealGunDBSwarm.FREE_RELAYS.length,
            });
            return true;
        }
        catch (error) {
            logger.error('Failed to connect to GunDB', { error });
            return false;
        }
    }
    /**
     * Register agent with swarm
     */
    async registerAgent(agentId, capabilities) {
        if (!this.connected || !this.swarmNode) {
            logger.warn('Not connected to GunDB');
            return;
        }
        const agentData = {
            id: agentId,
            capabilities: capabilities.join(','),
            joinedAt: Date.now(),
            status: 'active',
        };
        // Encrypt sensitive data
        const encrypted = this.crypto.encrypt(JSON.stringify(agentData), this.swarmKey);
        this.swarmNode.get('agents').get(agentId).put({
            ...encrypted,
            agentId, // Keep ID visible for routing
        });
        logger.debug('Agent registered to GunDB', { agentId });
    }
    /**
     * Publish message to swarm (real-time sync)
     */
    async publish(topic, data) {
        const messageId = this.crypto.hash(JSON.stringify(data) + Date.now()).slice(0, 16);
        const message = {
            id: messageId,
            topic,
            timestamp: Date.now(),
        };
        // Encrypt payload
        const encrypted = this.crypto.encrypt(JSON.stringify(data), this.swarmKey);
        if (this.connected && this.swarmNode) {
            this.swarmNode.get('messages').get(topic).get(messageId).put({
                ...message,
                ...encrypted,
            });
        }
        return messageId;
    }
    /**
     * Subscribe to topic
     */
    subscribe(topic, callback) {
        if (!this.connected || !this.swarmNode) {
            logger.warn('Not connected to GunDB');
            return;
        }
        this.swarmNode.get('messages').get(topic).map().on((msg, id) => {
            if (msg && msg.ciphertext) {
                try {
                    const decrypted = this.crypto.decrypt(msg.ciphertext, this.swarmKey, msg.iv, msg.tag);
                    callback(JSON.parse(decrypted));
                }
                catch (error) {
                    // Ignore decryption errors (wrong key)
                }
            }
        });
    }
    /**
     * Sync Q-table to swarm
     */
    async syncQTable(agentId, qTable) {
        return this.publish('q_table_sync', {
            agentId,
            qTable,
            dimensions: `${qTable.length}x${qTable[0]?.length || 0}`,
        });
    }
    /**
     * Sync memory vectors
     */
    async syncMemory(agentId, vectors, namespace) {
        return this.publish('memory_sync', {
            agentId,
            vectorCount: vectors.length,
            dimensions: vectors[0]?.length || 0,
            namespace,
            checksum: this.crypto.hash(JSON.stringify(vectors)).slice(0, 8),
        });
    }
    /**
     * Get connection status
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Get swarm key (for sharing)
     */
    getSwarmKey() {
        return this.swarmKey;
    }
    /**
     * Get swarm ID
     */
    getSwarmId() {
        return this.swarmId;
    }
}
/**
 * Real WebRTC Swarm (using PeerJS)
 */
export class RealWebRTCSwarm {
    peer = null;
    connections = new Map();
    crypto;
    swarmKey;
    swarmId;
    peerId = null;
    constructor(swarmKey) {
        this.crypto = new SwarmCrypto();
        this.swarmKey = swarmKey || this.crypto.generateKey();
        this.swarmId = this.crypto.hash(this.swarmKey).slice(0, 16);
    }
    /**
     * Initialize PeerJS connection
     */
    async initialize(agentId) {
        const PeerClass = await getPeer();
        if (!PeerClass) {
            logger.warn('PeerJS not available');
            return null;
        }
        return new Promise((resolve) => {
            try {
                this.peerId = `swarm-${this.swarmId}-${agentId}`;
                this.peer = new PeerClass(this.peerId);
                this.peer.on('open', (id) => {
                    logger.info('WebRTC peer connected', { peerId: id });
                    resolve(id);
                });
                this.peer.on('connection', (conn) => {
                    this.handleConnection(conn);
                });
                this.peer.on('error', (err) => {
                    logger.error('PeerJS error', { error: err.message });
                    resolve(null);
                });
                // Timeout after 10 seconds
                setTimeout(() => resolve(null), 10000);
            }
            catch (error) {
                logger.error('Failed to initialize PeerJS', { error });
                resolve(null);
            }
        });
    }
    /**
     * Handle incoming connection
     */
    handleConnection(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            logger.debug('Peer connected', { peer: conn.peer });
        });
        conn.on('data', (data) => {
            if (data.encrypted) {
                try {
                    const decrypted = this.crypto.decrypt(data.ciphertext, this.swarmKey, data.iv, data.tag);
                    this.handleMessage(JSON.parse(decrypted), conn.peer);
                }
                catch {
                    // Ignore decryption errors
                }
            }
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
        });
    }
    /**
     * Handle decrypted message
     */
    handleMessage(message, from) {
        logger.debug('Received P2P message', { from, type: message.type });
        // Override in subclass or add event emitter
    }
    /**
     * Connect to another peer
     */
    async connectToPeer(peerId) {
        if (!this.peer) {
            return false;
        }
        return new Promise((resolve) => {
            const conn = this.peer.connect(peerId);
            conn.on('open', () => {
                this.connections.set(peerId, conn);
                resolve(true);
            });
            conn.on('error', () => {
                resolve(false);
            });
            setTimeout(() => resolve(false), 5000);
        });
    }
    /**
     * Send encrypted message to peer
     */
    async sendToPeer(peerId, data) {
        const conn = this.connections.get(peerId);
        if (!conn) {
            return false;
        }
        const encrypted = this.crypto.encrypt(JSON.stringify(data), this.swarmKey);
        conn.send({
            encrypted: true,
            ...encrypted,
        });
        return true;
    }
    /**
     * Broadcast to all connected peers
     */
    async broadcast(data) {
        let sent = 0;
        for (const [peerId] of this.connections) {
            if (await this.sendToPeer(peerId, data)) {
                sent++;
            }
        }
        return sent;
    }
    /**
     * Get connected peer count
     */
    getConnectedPeers() {
        return this.connections.size;
    }
    /**
     * Get peer ID
     */
    getPeerId() {
        return this.peerId;
    }
    /**
     * Disconnect
     */
    disconnect() {
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.connections.clear();
    }
}
/**
 * Combined Real P2P Swarm Coordinator
 */
export class RealP2PSwarmCoordinator {
    gundb;
    webrtc;
    swarmKey;
    initialized = false;
    constructor(swarmKey) {
        const crypto = new SwarmCrypto();
        this.swarmKey = swarmKey || crypto.generateKey();
        this.gundb = new RealGunDBSwarm(this.swarmKey);
        this.webrtc = new RealWebRTCSwarm(this.swarmKey);
    }
    /**
     * Initialize all P2P connections
     */
    async initialize(agentId) {
        const gundbConnected = await this.gundb.connect();
        const webrtcPeerId = await this.webrtc.initialize(agentId);
        if (gundbConnected) {
            await this.gundb.registerAgent(agentId, ['coordinator']);
        }
        this.initialized = true;
        return {
            gundb: gundbConnected,
            webrtc: webrtcPeerId !== null,
            swarmId: this.gundb.getSwarmId(),
        };
    }
    /**
     * Publish via GunDB (real-time)
     */
    async publish(topic, data) {
        return this.gundb.publish(topic, data);
    }
    /**
     * Subscribe via GunDB
     */
    subscribe(topic, callback) {
        this.gundb.subscribe(topic, callback);
    }
    /**
     * Send direct P2P message
     */
    async sendDirect(peerId, data) {
        return this.webrtc.sendToPeer(peerId, data);
    }
    /**
     * Broadcast via WebRTC
     */
    async broadcastDirect(data) {
        return this.webrtc.broadcast(data);
    }
    /**
     * Sync learning state
     */
    async syncLearning(agentId, qTable, vectors) {
        const qTableId = await this.gundb.syncQTable(agentId, qTable);
        let memoryId;
        if (vectors && vectors.length > 0) {
            memoryId = await this.gundb.syncMemory(agentId, vectors, 'default');
        }
        return { qTableId, memoryId };
    }
    /**
     * Get status
     */
    getStatus() {
        return {
            gundb: this.gundb.isConnected(),
            webrtc: {
                connected: this.webrtc.getPeerId() !== null,
                peers: this.webrtc.getConnectedPeers(),
            },
            swarmId: this.gundb.getSwarmId(),
            swarmKey: this.swarmKey,
        };
    }
    /**
     * Cleanup
     */
    disconnect() {
        this.webrtc.disconnect();
    }
}
/**
 * Quick start helper
 */
export async function createRealP2PSwarm(agentId, swarmKey) {
    const swarm = new RealP2PSwarmCoordinator(swarmKey);
    await swarm.initialize(agentId);
    return swarm;
}
export { SwarmCrypto };
//# sourceMappingURL=real-p2p-swarm.js.map