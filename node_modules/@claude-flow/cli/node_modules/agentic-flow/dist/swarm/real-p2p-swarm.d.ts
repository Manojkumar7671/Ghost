/**
 * Real P2P Swarm Coordination
 *
 * IMPROVED VERSION with actual P2P connections:
 * - Real GunDB relay connections
 * - Actual WebRTC via PeerJS
 * - Persistent learning storage
 * - Better error handling
 */
/**
 * Encryption utilities
 */
declare class SwarmCrypto {
    private algorithm;
    generateKey(): string;
    encrypt(data: string, keyBase64: string): {
        ciphertext: string;
        iv: string;
        tag: string;
    };
    decrypt(ciphertext: string, keyBase64: string, ivBase64: string, tagBase64: string): string;
    hash(data: string): string;
}
/**
 * Real GunDB Swarm (connects to actual relays)
 */
export declare class RealGunDBSwarm {
    private gun;
    private swarmNode;
    private crypto;
    private swarmKey;
    private swarmId;
    private connected;
    static readonly FREE_RELAYS: string[];
    constructor(swarmKey?: string, relays?: string[]);
    /**
     * Connect to GunDB relays
     */
    connect(relays?: string[]): Promise<boolean>;
    /**
     * Register agent with swarm
     */
    registerAgent(agentId: string, capabilities: string[]): Promise<void>;
    /**
     * Publish message to swarm (real-time sync)
     */
    publish(topic: string, data: any): Promise<string>;
    /**
     * Subscribe to topic
     */
    subscribe(topic: string, callback: (data: any) => void): void;
    /**
     * Sync Q-table to swarm
     */
    syncQTable(agentId: string, qTable: number[][]): Promise<string>;
    /**
     * Sync memory vectors
     */
    syncMemory(agentId: string, vectors: number[][], namespace: string): Promise<string>;
    /**
     * Get connection status
     */
    isConnected(): boolean;
    /**
     * Get swarm key (for sharing)
     */
    getSwarmKey(): string;
    /**
     * Get swarm ID
     */
    getSwarmId(): string;
}
/**
 * Real WebRTC Swarm (using PeerJS)
 */
export declare class RealWebRTCSwarm {
    private peer;
    private connections;
    private crypto;
    private swarmKey;
    private swarmId;
    private peerId;
    constructor(swarmKey?: string);
    /**
     * Initialize PeerJS connection
     */
    initialize(agentId: string): Promise<string | null>;
    /**
     * Handle incoming connection
     */
    private handleConnection;
    /**
     * Handle decrypted message
     */
    private handleMessage;
    /**
     * Connect to another peer
     */
    connectToPeer(peerId: string): Promise<boolean>;
    /**
     * Send encrypted message to peer
     */
    sendToPeer(peerId: string, data: any): Promise<boolean>;
    /**
     * Broadcast to all connected peers
     */
    broadcast(data: any): Promise<number>;
    /**
     * Get connected peer count
     */
    getConnectedPeers(): number;
    /**
     * Get peer ID
     */
    getPeerId(): string | null;
    /**
     * Disconnect
     */
    disconnect(): void;
}
/**
 * Combined Real P2P Swarm Coordinator
 */
export declare class RealP2PSwarmCoordinator {
    private gundb;
    private webrtc;
    private swarmKey;
    private initialized;
    constructor(swarmKey?: string);
    /**
     * Initialize all P2P connections
     */
    initialize(agentId: string): Promise<{
        gundb: boolean;
        webrtc: boolean;
        swarmId: string;
    }>;
    /**
     * Publish via GunDB (real-time)
     */
    publish(topic: string, data: any): Promise<string>;
    /**
     * Subscribe via GunDB
     */
    subscribe(topic: string, callback: (data: any) => void): void;
    /**
     * Send direct P2P message
     */
    sendDirect(peerId: string, data: any): Promise<boolean>;
    /**
     * Broadcast via WebRTC
     */
    broadcastDirect(data: any): Promise<number>;
    /**
     * Sync learning state
     */
    syncLearning(agentId: string, qTable: number[][], vectors?: number[][]): Promise<{
        qTableId: string;
        memoryId?: string;
    }>;
    /**
     * Get status
     */
    getStatus(): {
        gundb: boolean;
        webrtc: {
            connected: boolean;
            peers: number;
        };
        swarmId: string;
        swarmKey: string;
    };
    /**
     * Cleanup
     */
    disconnect(): void;
}
/**
 * Quick start helper
 */
export declare function createRealP2PSwarm(agentId: string, swarmKey?: string): Promise<RealP2PSwarmCoordinator>;
export { SwarmCrypto };
//# sourceMappingURL=real-p2p-swarm.d.ts.map