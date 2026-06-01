/**
 * QUICConnection - Enhanced QUIC Connection with 0-RTT, BBR, and Migration
 *
 * Implements an advanced QUIC connection with:
 * - 0-RTT fast reconnect via session ticket caching
 * - BBR congestion control for optimal throughput
 * - Connection migration for resilient networking
 * - Latency tracking and performance metrics
 */
export interface QUICConnectionConfig {
    endpoint: string;
    enableZeroRTT?: boolean;
    enableMultipath?: boolean;
    congestionControl?: 'bbr' | 'cubic' | 'reno';
    maxIdleTimeoutMs?: number;
    initialRttMs?: number;
}
export interface ConnectionMetrics {
    rttMs: number;
    smoothedRttMs: number;
    rttVariance: number;
    bytesInFlight: number;
    congestionWindow: number;
    deliveryRate: number;
    packetsLost: number;
    packetsSent: number;
    packetsAcked: number;
    zeroRttUsed: boolean;
    handshakeTimeMs: number;
}
export declare class QUICConnection {
    private config;
    private connected;
    private busy;
    private sessionTicket;
    private bbrState;
    private metrics;
    private createdAt;
    private lastActiveAt;
    private migrationCount;
    private currentPath;
    private id;
    private static ticketCache;
    private static readonly TICKET_LIFETIME_MS;
    constructor(config: QUICConnectionConfig);
    /**
     * Connect to the QUIC endpoint.
     * Uses 0-RTT if a cached session ticket is available.
     */
    connect(): Promise<{
        zeroRtt: boolean;
        handshakeMs: number;
    }>;
    /**
     * 0-RTT connection using cached session ticket.
     * Sends early data in the initial flight, eliminating 1 RTT.
     */
    private connectWithZeroRTT;
    /**
     * Full TLS 1.3 handshake (1-RTT).
     */
    private connectFull;
    /**
     * Disconnect the connection.
     */
    disconnect(): Promise<void>;
    /**
     * Send data over this connection using BBR pacing.
     */
    send(data: Uint8Array | Buffer): Promise<{
        bytesAcked: number;
        rttMs: number;
    }>;
    /**
     * Migrate connection to a new network path.
     * QUIC supports connection migration without re-handshake.
     */
    migrate(newEndpoint: string): Promise<{
        success: boolean;
        previousPath: string;
    }>;
    /**
     * Compute BBR pacing delay for a given packet size.
     */
    private computeBBRPacingDelay;
    /**
     * Update BBR state machine with a new delivery sample.
     */
    private updateBBR;
    /**
     * Compute Bandwidth-Delay Product.
     */
    private computeBDP;
    /**
     * Update smoothed RTT using exponential weighted moving average.
     */
    private updateSmoothedRtt;
    private generateSessionTicket;
    private initBBR;
    private initMetrics;
    getId(): string;
    isConnected(): boolean;
    isBusy(): boolean;
    getEndpoint(): string;
    getCurrentPath(): string;
    getCreatedAt(): number;
    getLastActiveAt(): number;
    getMigrationCount(): number;
    getMetrics(): ConnectionMetrics;
    getBBRMode(): string;
    hasSessionTicket(): boolean;
    /**
     * Clear session ticket cache (for testing or security reset).
     */
    static clearTicketCache(): void;
    /**
     * Get the number of cached session tickets.
     */
    static getTicketCacheSize(): number;
    private sleep;
}
//# sourceMappingURL=QUICConnection.d.ts.map