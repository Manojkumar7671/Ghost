/**
 * QUICConnectionPool - Connection Pooling for QUIC Protocol
 *
 * Manages a pool of QUICConnection instances for efficient reuse:
 * - Maximum pool size of 10 connections per endpoint
 * - Connection reuse with idle detection
 * - Automatic cleanup of stale/expired connections
 * - Pool-level statistics and health monitoring
 * - Graceful drain and shutdown
 */
import { QUICConnection } from './QUICConnection.js';
export interface PoolConfig {
    maxPoolSize?: number;
    maxIdleTimeMs?: number;
    acquireTimeoutMs?: number;
    enableZeroRTT?: boolean;
    congestionControl?: 'bbr' | 'cubic' | 'reno';
    healthCheckIntervalMs?: number;
}
export interface PoolStats {
    endpoint: string;
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    totalAcquired: number;
    totalReleased: number;
    totalCreated: number;
    totalDestroyed: number;
    avgAcquireTimeMs: number;
    avgRttMs: number;
    zeroRttHits: number;
    zeroRttMisses: number;
}
export declare class QUICConnectionPool {
    private pools;
    private config;
    private stats;
    private cleanupTimer;
    constructor(config?: PoolConfig);
    /**
     * Acquire a connection from the pool.
     * Reuses idle connections or creates new ones up to maxPoolSize.
     */
    getConnection(endpoint: string): Promise<QUICConnection>;
    /**
     * Release a connection back to the pool (mark as not busy).
     * The connection stays in the pool for reuse.
     */
    releaseConnection(conn: QUICConnection): void;
    /**
     * Remove a specific connection from the pool and disconnect it.
     */
    removeConnection(conn: QUICConnection): Promise<void>;
    /**
     * Get pool statistics for a specific endpoint.
     */
    getPoolStats(endpoint: string): PoolStats;
    /**
     * Get stats for all endpoints.
     */
    getAllPoolStats(): PoolStats[];
    /**
     * Get total number of connections across all pools.
     */
    getTotalConnections(): number;
    /**
     * Drain and close all connections for an endpoint.
     */
    drainEndpoint(endpoint: string): Promise<number>;
    /**
     * Drain and close ALL connections.
     */
    shutdown(): Promise<number>;
    /**
     * Remove idle connections that exceed maxIdleTimeMs.
     */
    cleanup(): Promise<number>;
    private createConnection;
    private waitForAvailableConnection;
    private ensureStats;
    private startCleanup;
}
//# sourceMappingURL=QUICConnectionPool.d.ts.map