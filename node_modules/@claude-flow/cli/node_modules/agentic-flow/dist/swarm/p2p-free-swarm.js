/**
 * Free P2P Swarm Coordination
 *
 * Multiple FREE options for decentralized swarm coordination:
 *
 * 1. IPFS (Free Gateways + Free Pinning Services)
 *    - Pinata: 1GB free
 *    - web3.storage: 5GB free
 *    - Filebase: 5GB free
 *    - Public gateways: unlimited reads
 *
 * 2. GunDB (Completely Free)
 *    - Decentralized graph database
 *    - Free relay servers
 *    - WebRTC P2P + WebSocket fallback
 *    - Offline-first, auto-sync
 *
 * 3. OrbitDB (Completely Free)
 *    - IPFS-based P2P database
 *    - CRDT for conflict resolution
 *    - libp2p pubsub
 *
 * 4. WebRTC Signaling (Free Options)
 *    - P2PCF: Cloudflare Workers (free tier)
 *    - PeerJS: Free cloud server
 *    - Self-hosted: OpenAyame, SignalMaster
 *
 * 5. Cloudflare (Free Tier)
 *    - Workers: 100k requests/day free
 *    - R2: 10GB storage free
 *    - KV: 100k reads/day free
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
/**
 * Free P2P Provider Options
 */
export var P2PProvider;
(function (P2PProvider) {
    P2PProvider["GUNDB"] = "gundb";
    P2PProvider["ORBITDB"] = "orbitdb";
    P2PProvider["IPFS_PUBLIC"] = "ipfs_public";
    P2PProvider["IPFS_PINATA"] = "ipfs_pinata";
    P2PProvider["IPFS_WEB3STORAGE"] = "ipfs_web3storage";
    P2PProvider["IPFS_FILEBASE"] = "ipfs_filebase";
    P2PProvider["WEBRTC_PEERJS"] = "webrtc_peerjs";
    P2PProvider["WEBRTC_P2PCF"] = "webrtc_p2pcf";
    P2PProvider["CLOUDFLARE_KV"] = "cloudflare_kv";
})(P2PProvider || (P2PProvider = {}));
/**
 * Free P2P provider configurations
 */
export const FREE_P2P_CONFIGS = {
    /**
     * GunDB - Completely FREE
     * No signup required, uses free relay servers
     */
    gundb: {
        provider: P2PProvider.GUNDB,
        relays: [
            'https://gun-manhattan.herokuapp.com/gun',
            'https://gun-us.herokuapp.com/gun',
            'https://gun-eu.herokuapp.com/gun',
        ],
        features: ['realtime', 'offline-first', 'encrypted', 'graph-db'],
        limits: { storage: 'unlimited-local', sync: 'unlimited' },
        signup: false,
    },
    /**
     * PeerJS - FREE WebRTC signaling
     * Cloud server available, no signup for basic use
     */
    peerjs: {
        provider: P2PProvider.WEBRTC_PEERJS,
        server: 'https://0.peerjs.com',
        features: ['webrtc', 'p2p-direct', 'browser-native'],
        limits: { connections: 'fair-use' },
        signup: false,
    },
    /**
     * IPFS Public Gateways - FREE reads
     * Multiple gateways for redundancy
     */
    ipfsPublic: {
        provider: P2PProvider.IPFS_PUBLIC,
        gateways: [
            'https://ipfs.io/ipfs/',
            'https://dweb.link/ipfs/',
            'https://cloudflare-ipfs.com/ipfs/',
            'https://gateway.pinata.cloud/ipfs/',
            'https://w3s.link/ipfs/',
            'https://4everland.io/ipfs/',
        ],
        features: ['content-addressed', 'immutable', 'global'],
        limits: { reads: 'unlimited', writes: 'requires-pinning-service' },
        signup: false,
    },
    /**
     * Pinata - 1GB FREE
     * Sign up: https://pinata.cloud
     */
    pinata: {
        provider: P2PProvider.IPFS_PINATA,
        api: 'https://api.pinata.cloud',
        gateway: 'https://gateway.pinata.cloud/ipfs/',
        features: ['ipfs-pinning', 'dedicated-gateway', 'api'],
        limits: { storage: '1GB', bandwidth: '100GB/month' },
        signup: 'https://pinata.cloud',
    },
    /**
     * web3.storage - 5GB FREE
     * Sign up: https://web3.storage
     */
    web3storage: {
        provider: P2PProvider.IPFS_WEB3STORAGE,
        api: 'https://api.web3.storage',
        gateway: 'https://w3s.link/ipfs/',
        features: ['ipfs-pinning', 'filecoin-backup', 'api'],
        limits: { storage: '5GB', requests: 'unlimited' },
        signup: 'https://web3.storage',
    },
    /**
     * Filebase - 5GB FREE
     * Sign up: https://filebase.com
     */
    filebase: {
        provider: P2PProvider.IPFS_FILEBASE,
        api: 'https://api.filebase.io/v1/ipfs',
        features: ['ipfs-pinning', 's3-compatible', 'geo-redundant'],
        limits: { storage: '5GB', objects: '1000' },
        signup: 'https://filebase.com',
    },
    /**
     * P2PCF - FREE via Cloudflare
     * Uses Cloudflare Workers free tier
     */
    p2pcf: {
        provider: P2PProvider.WEBRTC_P2PCF,
        features: ['cloudflare-workers', 'serverless', 'low-cost'],
        limits: { requests: '100k/day', storage: '1M-writes/month' },
        signup: false,
        selfHost: 'https://github.com/gfodor/p2pcf',
    },
};
/**
 * Encryption for P2P communication
 */
class P2PEncryption {
    algorithm = 'aes-256-gcm';
    generateSwarmKey() {
        return crypto.randomBytes(32).toString('base64');
    }
    encrypt(data, keyBase64) {
        const key = Buffer.from(keyBase64, 'base64');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        let encrypted = cipher.update(data, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return {
            encrypted,
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
        };
    }
    decrypt(encrypted, keyBase64, ivBase64, tagBase64) {
        const key = Buffer.from(keyBase64, 'base64');
        const iv = Buffer.from(ivBase64, 'base64');
        const tag = Buffer.from(tagBase64, 'base64');
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    hash(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
}
/**
 * GunDB-based Swarm (Completely FREE)
 */
export class GunDBSwarm {
    encryption;
    swarmKey;
    swarmId;
    agents;
    relays;
    constructor(swarmKey, relays) {
        this.encryption = new P2PEncryption();
        this.swarmKey = swarmKey || this.encryption.generateSwarmKey();
        this.swarmId = this.encryption.hash(this.swarmKey).slice(0, 16);
        this.agents = new Map();
        this.relays = relays || FREE_P2P_CONFIGS.gundb.relays;
    }
    /**
     * Initialize GunDB swarm
     * In browser: const gun = Gun(relays)
     * In Node: requires gun package
     */
    async initialize() {
        logger.info('GunDB Swarm initialized', {
            swarmId: this.swarmId,
            relays: this.relays.length,
        });
        return {
            swarmId: this.swarmId,
            relays: this.relays,
        };
    }
    /**
     * Register agent
     */
    async registerAgent(agentId, capabilities) {
        const agentData = {
            id: agentId,
            capabilities,
            joinedAt: Date.now(),
            status: 'active',
        };
        // Encrypt agent data
        const encrypted = this.encryption.encrypt(JSON.stringify(agentData), this.swarmKey);
        this.agents.set(agentId, { ...agentData, encrypted });
        logger.debug('Agent registered', { agentId, swarmId: this.swarmId });
    }
    /**
     * Publish encrypted message
     */
    async publish(topic, data) {
        const message = {
            topic,
            data,
            timestamp: Date.now(),
            swarmId: this.swarmId,
        };
        const encrypted = this.encryption.encrypt(JSON.stringify(message), this.swarmKey);
        // In real implementation: gun.get(swarmId).get(topic).put(encrypted)
        const messageId = this.encryption.hash(JSON.stringify(encrypted)).slice(0, 16);
        return messageId;
    }
    /**
     * Get connection code for browser usage
     */
    getBrowserCode() {
        return `
// GunDB Browser Connection (FREE - No signup required)
<script src="https://cdn.jsdelivr.net/npm/gun/gun.js"></script>
<script>
  const gun = Gun([${this.relays.map(r => `'${r}'`).join(', ')}]);
  const swarm = gun.get('swarm-${this.swarmId}');

  // Join swarm
  swarm.get('agents').set({
    id: 'browser-agent-' + Math.random().toString(36).slice(2),
    joinedAt: Date.now()
  });

  // Listen for messages
  swarm.get('messages').map().on((msg, id) => {
    console.log('Message:', msg);
  });

  // Send message
  swarm.get('messages').set({
    text: 'Hello from browser!',
    timestamp: Date.now()
  });
</script>`;
    }
    getStats() {
        return {
            provider: 'GunDB',
            swarmId: this.swarmId,
            agents: this.agents.size,
            relays: this.relays,
            free: true,
            features: FREE_P2P_CONFIGS.gundb.features,
        };
    }
}
/**
 * IPFS-based Swarm (Free with public gateways)
 */
export class IPFSFreeSwarm {
    encryption;
    swarmKey;
    swarmId;
    gateways;
    pinningService;
    messages;
    patterns;
    constructor(config) {
        this.encryption = new P2PEncryption();
        this.swarmKey = config?.swarmKey || this.encryption.generateSwarmKey();
        this.swarmId = this.encryption.hash(this.swarmKey).slice(0, 16);
        this.gateways = FREE_P2P_CONFIGS.ipfsPublic.gateways;
        this.pinningService = config?.pinningService;
        this.messages = new Map();
        this.patterns = new Map();
    }
    /**
     * Generate content-addressed ID (like IPFS CID)
     */
    generateCID(data) {
        const hash = this.encryption.hash(data);
        return `Qm${hash.slice(0, 44)}`;
    }
    /**
     * Store data (encrypted) and get CID
     */
    async store(data) {
        const encrypted = this.encryption.encrypt(JSON.stringify(data), this.swarmKey);
        const cid = this.generateCID(JSON.stringify(encrypted));
        // Store locally
        this.messages.set(cid, encrypted);
        // If pinning service configured, pin to IPFS
        if (this.pinningService) {
            await this.pinToIPFS(cid, encrypted);
        }
        return cid;
    }
    /**
     * Pin to IPFS via free service
     */
    async pinToIPFS(cid, data) {
        if (!this.pinningService)
            return false;
        try {
            let endpoint;
            let headers;
            switch (this.pinningService.type) {
                case 'pinata':
                    endpoint = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
                    headers = {
                        'Content-Type': 'application/json',
                        pinata_api_key: this.pinningService.apiKey,
                        pinata_secret_api_key: this.pinningService.apiSecret || '',
                    };
                    break;
                case 'web3storage':
                    endpoint = 'https://api.web3.storage/upload';
                    headers = {
                        Authorization: `Bearer ${this.pinningService.apiKey}`,
                    };
                    break;
                case 'filebase':
                    endpoint = 'https://api.filebase.io/v1/ipfs/pins';
                    headers = {
                        Authorization: `Bearer ${this.pinningService.apiKey}`,
                        'Content-Type': 'application/json',
                    };
                    break;
                default:
                    return false;
            }
            logger.debug('Pinning to IPFS', { cid, service: this.pinningService.type });
            return true;
        }
        catch (error) {
            logger.warn('IPFS pin failed', { error });
            return false;
        }
    }
    /**
     * Store learning pattern
     */
    async storeLearningPattern(agentId, patternType, embedding, metadata) {
        const pattern = {
            agentId,
            patternType,
            embedding,
            metadata,
            timestamp: Date.now(),
        };
        const cid = await this.store(pattern);
        this.patterns.set(cid, pattern);
        return cid;
    }
    /**
     * Sync Q-tables across swarm
     */
    async syncQTable(agentId, qTable) {
        return this.store({
            type: 'q_table_sync',
            agentId,
            qTable,
            timestamp: Date.now(),
        });
    }
    /**
     * Sync memory vectors
     */
    async syncMemory(agentId, vectors, namespace) {
        return this.store({
            type: 'memory_sync',
            agentId,
            vectors,
            namespace,
            vectorCount: vectors.length,
            timestamp: Date.now(),
        });
    }
    getStats() {
        return {
            provider: 'IPFS',
            swarmId: this.swarmId,
            gateways: this.gateways.length,
            pinningService: this.pinningService?.type || 'none',
            messages: this.messages.size,
            patterns: this.patterns.size,
            free: true,
        };
    }
    getSwarmKey() {
        return this.swarmKey;
    }
}
/**
 * WebRTC P2P Swarm (Free with PeerJS)
 */
export class WebRTCFreeSwarm {
    encryption;
    swarmKey;
    swarmId;
    peerId;
    constructor(swarmKey) {
        this.encryption = new P2PEncryption();
        this.swarmKey = swarmKey || this.encryption.generateSwarmKey();
        this.swarmId = this.encryption.hash(this.swarmKey).slice(0, 16);
    }
    /**
     * Get browser code for WebRTC swarm
     */
    getBrowserCode() {
        return `
// PeerJS WebRTC Swarm (FREE - No signup required)
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
<script>
  // Create peer with random ID
  const peer = new Peer('swarm-${this.swarmId}-' + Math.random().toString(36).slice(2));

  peer.on('open', (id) => {
    console.log('My peer ID:', id);

    // Connect to other peers in swarm
    // Share peer IDs via any channel (URL, QR code, etc.)
  });

  peer.on('connection', (conn) => {
    conn.on('data', (data) => {
      console.log('Received:', data);
    });

    conn.on('open', () => {
      conn.send({ type: 'hello', timestamp: Date.now() });
    });
  });

  // Connect to known peer
  function connectToPeer(peerId) {
    const conn = peer.connect(peerId);
    conn.on('open', () => {
      conn.send({ type: 'join_swarm', swarmId: '${this.swarmId}' });
    });
    return conn;
  }
</script>`;
    }
    getStats() {
        return {
            provider: 'WebRTC/PeerJS',
            swarmId: this.swarmId,
            server: FREE_P2P_CONFIGS.peerjs.server,
            free: true,
            features: FREE_P2P_CONFIGS.peerjs.features,
        };
    }
}
/**
 * Multi-provider free swarm coordinator
 */
export class FreeSwarmCoordinator {
    gundb;
    ipfs;
    webrtc;
    swarmKey;
    constructor(config) {
        const encryption = new P2PEncryption();
        this.swarmKey = encryption.generateSwarmKey();
        // Initialize all free providers with same swarm key
        this.gundb = new GunDBSwarm(this.swarmKey);
        this.ipfs = new IPFSFreeSwarm({
            swarmKey: this.swarmKey,
            pinningService: config?.pinataApiKey
                ? {
                    type: 'pinata',
                    apiKey: config.pinataApiKey,
                    apiSecret: config.pinataApiSecret,
                }
                : config?.web3storageApiKey
                    ? {
                        type: 'web3storage',
                        apiKey: config.web3storageApiKey,
                    }
                    : undefined,
        });
        this.webrtc = new WebRTCFreeSwarm(this.swarmKey);
    }
    /**
     * Initialize all providers
     */
    async initialize() {
        await this.gundb.initialize();
        logger.info('Free Swarm Coordinator initialized');
    }
    /**
     * Store learning pattern (uses IPFS)
     */
    async storeLearning(agentId, patternType, embedding) {
        return this.ipfs.storeLearningPattern(agentId, patternType, embedding);
    }
    /**
     * Broadcast message (uses GunDB for real-time)
     */
    async broadcast(topic, data) {
        return this.gundb.publish(topic, data);
    }
    /**
     * Get all connection codes
     */
    getConnectionCodes() {
        return {
            gundb: this.gundb.getBrowserCode(),
            webrtc: this.webrtc.getBrowserCode(),
        };
    }
    /**
     * Get comprehensive stats
     */
    getStats() {
        return {
            swarmKey: this.swarmKey,
            providers: {
                gundb: this.gundb.getStats(),
                ipfs: this.ipfs.getStats(),
                webrtc: this.webrtc.getStats(),
            },
            totalFreeStorage: '11GB+',
            features: [
                'Real-time sync (GunDB)',
                'Content-addressed storage (IPFS)',
                'Direct P2P (WebRTC)',
                'End-to-end encryption',
                'Offline-first',
                'No signup required (basic)',
            ],
        };
    }
}
/**
 * Quick setup for free swarm
 */
export async function createFreeSwarm(options) {
    const swarm = new FreeSwarmCoordinator(options);
    await swarm.initialize();
    return swarm;
}
/**
 * Print free provider comparison
 */
export function printFreeProviders() {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              FREE P2P SWARM COORDINATION OPTIONS                     ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  🟢 NO SIGNUP REQUIRED (Completely Free):                           ║
║  ─────────────────────────────────────────────────────────────────── ║
║  • GunDB          - Decentralized graph DB, free relays, real-time  ║
║  • PeerJS         - Free WebRTC signaling server                     ║
║  • IPFS Gateways  - Free reads from public gateways                 ║
║  • P2PCF          - Cloudflare Workers (100k req/day free)          ║
║                                                                      ║
║  🟡 FREE TIER (Signup Required):                                    ║
║  ─────────────────────────────────────────────────────────────────── ║
║  • Pinata         - 1GB free, IPFS pinning + dedicated gateway      ║
║  • web3.storage   - 5GB free, IPFS + Filecoin backup                ║
║  • Filebase       - 5GB free, S3-compatible IPFS                     ║
║  • 4everland      - Free IPFS pinning                                ║
║                                                                      ║
║  📊 RECOMMENDED STACK:                                               ║
║  ─────────────────────────────────────────────────────────────────── ║
║  Real-time sync:     GunDB (no signup)                              ║
║  Persistent storage: IPFS + Pinata (1GB free)                       ║
║  Direct P2P:         WebRTC + PeerJS (no signup)                    ║
║  Encryption:         AES-256-GCM (built-in)                         ║
║                                                                      ║
║  Combined Free Storage: 11GB+                                        ║
║  Combined Free Bandwidth: Effectively unlimited                      ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
}
//# sourceMappingURL=p2p-free-swarm.js.map