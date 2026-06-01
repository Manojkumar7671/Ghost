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
/**
 * Free P2P Provider Options
 */
export declare enum P2PProvider {
    GUNDB = "gundb",
    ORBITDB = "orbitdb",
    IPFS_PUBLIC = "ipfs_public",
    IPFS_PINATA = "ipfs_pinata",
    IPFS_WEB3STORAGE = "ipfs_web3storage",
    IPFS_FILEBASE = "ipfs_filebase",
    WEBRTC_PEERJS = "webrtc_peerjs",
    WEBRTC_P2PCF = "webrtc_p2pcf",
    CLOUDFLARE_KV = "cloudflare_kv"
}
/**
 * Free P2P provider configurations
 */
export declare const FREE_P2P_CONFIGS: {
    /**
     * GunDB - Completely FREE
     * No signup required, uses free relay servers
     */
    gundb: {
        provider: P2PProvider;
        relays: string[];
        features: string[];
        limits: {
            storage: string;
            sync: string;
        };
        signup: boolean;
    };
    /**
     * PeerJS - FREE WebRTC signaling
     * Cloud server available, no signup for basic use
     */
    peerjs: {
        provider: P2PProvider;
        server: string;
        features: string[];
        limits: {
            connections: string;
        };
        signup: boolean;
    };
    /**
     * IPFS Public Gateways - FREE reads
     * Multiple gateways for redundancy
     */
    ipfsPublic: {
        provider: P2PProvider;
        gateways: string[];
        features: string[];
        limits: {
            reads: string;
            writes: string;
        };
        signup: boolean;
    };
    /**
     * Pinata - 1GB FREE
     * Sign up: https://pinata.cloud
     */
    pinata: {
        provider: P2PProvider;
        api: string;
        gateway: string;
        features: string[];
        limits: {
            storage: string;
            bandwidth: string;
        };
        signup: string;
    };
    /**
     * web3.storage - 5GB FREE
     * Sign up: https://web3.storage
     */
    web3storage: {
        provider: P2PProvider;
        api: string;
        gateway: string;
        features: string[];
        limits: {
            storage: string;
            requests: string;
        };
        signup: string;
    };
    /**
     * Filebase - 5GB FREE
     * Sign up: https://filebase.com
     */
    filebase: {
        provider: P2PProvider;
        api: string;
        features: string[];
        limits: {
            storage: string;
            objects: string;
        };
        signup: string;
    };
    /**
     * P2PCF - FREE via Cloudflare
     * Uses Cloudflare Workers free tier
     */
    p2pcf: {
        provider: P2PProvider;
        features: string[];
        limits: {
            requests: string;
            storage: string;
        };
        signup: boolean;
        selfHost: string;
    };
};
/**
 * GunDB-based Swarm (Completely FREE)
 */
export declare class GunDBSwarm {
    private encryption;
    private swarmKey;
    private swarmId;
    private agents;
    private relays;
    constructor(swarmKey?: string, relays?: string[]);
    /**
     * Initialize GunDB swarm
     * In browser: const gun = Gun(relays)
     * In Node: requires gun package
     */
    initialize(): Promise<{
        swarmId: string;
        relays: string[];
    }>;
    /**
     * Register agent
     */
    registerAgent(agentId: string, capabilities: string[]): Promise<void>;
    /**
     * Publish encrypted message
     */
    publish(topic: string, data: any): Promise<string>;
    /**
     * Get connection code for browser usage
     */
    getBrowserCode(): string;
    getStats(): {
        provider: string;
        swarmId: string;
        agents: number;
        relays: string[];
        free: boolean;
        features: string[];
    };
}
/**
 * IPFS-based Swarm (Free with public gateways)
 */
export declare class IPFSFreeSwarm {
    private encryption;
    private swarmKey;
    private swarmId;
    private gateways;
    private pinningService?;
    private messages;
    private patterns;
    constructor(config?: {
        swarmKey?: string;
        pinningService?: {
            type: 'pinata' | 'web3storage' | 'filebase';
            apiKey: string;
            apiSecret?: string;
        };
    });
    /**
     * Generate content-addressed ID (like IPFS CID)
     */
    private generateCID;
    /**
     * Store data (encrypted) and get CID
     */
    store(data: any): Promise<string>;
    /**
     * Pin to IPFS via free service
     */
    private pinToIPFS;
    /**
     * Store learning pattern
     */
    storeLearningPattern(agentId: string, patternType: string, embedding: number[], metadata?: Record<string, any>): Promise<string>;
    /**
     * Sync Q-tables across swarm
     */
    syncQTable(agentId: string, qTable: number[][]): Promise<string>;
    /**
     * Sync memory vectors
     */
    syncMemory(agentId: string, vectors: number[][], namespace: string): Promise<string>;
    getStats(): {
        provider: string;
        swarmId: string;
        gateways: number;
        pinningService: string;
        messages: number;
        patterns: number;
        free: boolean;
    };
    getSwarmKey(): string;
}
/**
 * WebRTC P2P Swarm (Free with PeerJS)
 */
export declare class WebRTCFreeSwarm {
    private encryption;
    private swarmKey;
    private swarmId;
    private peerId?;
    constructor(swarmKey?: string);
    /**
     * Get browser code for WebRTC swarm
     */
    getBrowserCode(): string;
    getStats(): {
        provider: string;
        swarmId: string;
        server: string;
        free: boolean;
        features: string[];
    };
}
/**
 * Multi-provider free swarm coordinator
 */
export declare class FreeSwarmCoordinator {
    private gundb;
    private ipfs;
    private webrtc;
    private swarmKey;
    constructor(config?: {
        pinataApiKey?: string;
        pinataApiSecret?: string;
        web3storageApiKey?: string;
    });
    /**
     * Initialize all providers
     */
    initialize(): Promise<void>;
    /**
     * Store learning pattern (uses IPFS)
     */
    storeLearning(agentId: string, patternType: string, embedding: number[]): Promise<string>;
    /**
     * Broadcast message (uses GunDB for real-time)
     */
    broadcast(topic: string, data: any): Promise<string>;
    /**
     * Get all connection codes
     */
    getConnectionCodes(): {
        gundb: string;
        webrtc: string;
    };
    /**
     * Get comprehensive stats
     */
    getStats(): {
        swarmKey: string;
        providers: {
            gundb: {
                provider: string;
                swarmId: string;
                agents: number;
                relays: string[];
                free: boolean;
                features: string[];
            };
            ipfs: {
                provider: string;
                swarmId: string;
                gateways: number;
                pinningService: string;
                messages: number;
                patterns: number;
                free: boolean;
            };
            webrtc: {
                provider: string;
                swarmId: string;
                server: string;
                free: boolean;
                features: string[];
            };
        };
        totalFreeStorage: string;
        features: string[];
    };
}
/**
 * Quick setup for free swarm
 */
export declare function createFreeSwarm(options?: {
    pinataApiKey?: string;
    web3storageApiKey?: string;
}): Promise<FreeSwarmCoordinator>;
/**
 * Print free provider comparison
 */
export declare function printFreeProviders(): void;
//# sourceMappingURL=p2p-free-swarm.d.ts.map