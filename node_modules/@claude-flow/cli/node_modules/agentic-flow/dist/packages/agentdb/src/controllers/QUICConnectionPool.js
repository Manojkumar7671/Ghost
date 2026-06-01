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
export class QUICConnectionPool {
    pools = new Map();
    config;
    stats = new Map();
    cleanupTimer = null;
    constructor(config) {
        this.config = {
            maxPoolSize: config?.maxPoolSize ?? 10,
            maxIdleTimeMs: config?.maxIdleTimeMs ?? 60000,
            acquireTimeoutMs: config?.acquireTimeoutMs ?? 10000,
            enableZeroRTT: config?.enableZeroRTT ?? true,
            congestionControl: config?.congestionControl ?? 'bbr',
            healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 30000,
        };
        this.startCleanup();
    }
    /**
     * Acquire a connection from the pool.
     * Reuses idle connections or creates new ones up to maxPoolSize.
     */
    async getConnection(endpoint) {
        const startTime = performance.now();
        this.ensureStats(endpoint);
        const poolStats = this.stats.get(endpoint);
        const pool = this.pools.get(endpoint) || [];
        this.pools.set(endpoint, pool);
        // Try to reuse an idle connection
        for (const conn of pool) {
            if (!conn.isBusy() && conn.isConnected()) {
                poolStats.totalAcquired++;
                poolStats.acquireTimesMs.push(performance.now() - startTime);
                return conn;
            }
        }
        // Create a new connection if pool is not full
        if (pool.length < this.config.maxPoolSize) {
            const conn = await this.createConnection(endpoint);
            pool.push(conn);
            poolStats.totalCreated++;
            poolStats.totalAcquired++;
            // Track 0-RTT usage
            const metrics = conn.getMetrics();
            if (metrics.zeroRttUsed) {
                poolStats.zeroRttHits++;
            }
            else {
                poolStats.zeroRttMisses++;
            }
            poolStats.acquireTimesMs.push(performance.now() - startTime);
            return conn;
        }
        // Pool is full: wait for an available connection
        return this.waitForAvailableConnection(endpoint, startTime);
    }
    /**
     * Release a connection back to the pool (mark as not busy).
     * The connection stays in the pool for reuse.
     */
    releaseConnection(conn) {
        const endpoint = conn.getEndpoint();
        this.ensureStats(endpoint);
        this.stats.get(endpoint).totalReleased++;
        // Connection automatically becomes non-busy after send completes
    }
    /**
     * Remove a specific connection from the pool and disconnect it.
     */
    async removeConnection(conn) {
        const endpoint = conn.getEndpoint();
        const pool = this.pools.get(endpoint);
        if (!pool)
            return;
        const idx = pool.indexOf(conn);
        if (idx !== -1) {
            pool.splice(idx, 1);
            await conn.disconnect();
            this.ensureStats(endpoint);
            this.stats.get(endpoint).totalDestroyed++;
        }
    }
    /**
     * Get pool statistics for a specific endpoint.
     */
    getPoolStats(endpoint) {
        const pool = this.pools.get(endpoint) || [];
        this.ensureStats(endpoint);
        const s = this.stats.get(endpoint);
        const activeConnections = pool.filter(c => c.isBusy()).length;
        const idleConnections = pool.filter(c => !c.isBusy() && c.isConnected()).length;
        const avgAcquire = s.acquireTimesMs.length > 0
            ? s.acquireTimesMs.reduce((a, b) => a + b, 0) / s.acquireTimesMs.length
            : 0;
        const rttValues = pool
            .filter(c => c.isConnected())
            .map(c => c.getMetrics().smoothedRttMs)
            .filter(r => r > 0);
        const avgRtt = rttValues.length > 0
            ? rttValues.reduce((a, b) => a + b, 0) / rttValues.length
            : 0;
        return {
            endpoint,
            totalConnections: pool.length,
            activeConnections,
            idleConnections,
            totalAcquired: s.totalAcquired,
            totalReleased: s.totalReleased,
            totalCreated: s.totalCreated,
            totalDestroyed: s.totalDestroyed,
            avgAcquireTimeMs: Number(avgAcquire.toFixed(3)),
            avgRttMs: Number(avgRtt.toFixed(3)),
            zeroRttHits: s.zeroRttHits,
            zeroRttMisses: s.zeroRttMisses,
        };
    }
    /**
     * Get stats for all endpoints.
     */
    getAllPoolStats() {
        return Array.from(this.pools.keys()).map(ep => this.getPoolStats(ep));
    }
    /**
     * Get total number of connections across all pools.
     */
    getTotalConnections() {
        let total = 0;
        for (const pool of this.pools.values()) {
            total += pool.length;
        }
        return total;
    }
    /**
     * Drain and close all connections for an endpoint.
     */
    async drainEndpoint(endpoint) {
        const pool = this.pools.get(endpoint);
        if (!pool)
            return 0;
        let closed = 0;
        for (const conn of pool) {
            await conn.disconnect();
            closed++;
        }
        this.pools.delete(endpoint);
        this.ensureStats(endpoint);
        this.stats.get(endpoint).totalDestroyed += closed;
        return closed;
    }
    /**
     * Drain and close ALL connections.
     */
    async shutdown() {
        let total = 0;
        for (const endpoint of Array.from(this.pools.keys())) {
            total += await this.drainEndpoint(endpoint);
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        return total;
    }
    /**
     * Remove idle connections that exceed maxIdleTimeMs.
     */
    async cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [endpoint, pool] of this.pools.entries()) {
            const toRemove = [];
            for (const conn of pool) {
                if (!conn.isBusy() && (now - conn.getLastActiveAt()) > this.config.maxIdleTimeMs) {
                    toRemove.push(conn);
                }
            }
            for (const conn of toRemove) {
                const idx = pool.indexOf(conn);
                if (idx !== -1) {
                    pool.splice(idx, 1);
                    await conn.disconnect();
                    cleaned++;
                }
            }
            this.ensureStats(endpoint);
            this.stats.get(endpoint).totalDestroyed += toRemove.length;
            // Remove empty pools
            if (pool.length === 0) {
                this.pools.delete(endpoint);
            }
        }
        return cleaned;
    }
    // -- Private helpers --
    async createConnection(endpoint) {
        const connConfig = {
            endpoint,
            enableZeroRTT: this.config.enableZeroRTT,
            enableMultipath: false,
            congestionControl: this.config.congestionControl,
        };
        const conn = new QUICConnection(connConfig);
        await conn.connect();
        return conn;
    }
    async waitForAvailableConnection(endpoint, startTime) {
        const deadline = startTime + this.config.acquireTimeoutMs;
        while (performance.now() < deadline) {
            const pool = this.pools.get(endpoint) || [];
            for (const conn of pool) {
                if (!conn.isBusy() && conn.isConnected()) {
                    this.ensureStats(endpoint);
                    const s = this.stats.get(endpoint);
                    s.totalAcquired++;
                    s.acquireTimesMs.push(performance.now() - startTime);
                    return conn;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error(`Connection pool exhausted for ${endpoint} ` +
            `(max: ${this.config.maxPoolSize}, timeout: ${this.config.acquireTimeoutMs}ms)`);
    }
    ensureStats(endpoint) {
        if (!this.stats.has(endpoint)) {
            this.stats.set(endpoint, {
                totalAcquired: 0,
                totalReleased: 0,
                totalCreated: 0,
                totalDestroyed: 0,
                acquireTimesMs: [],
                zeroRttHits: 0,
                zeroRttMisses: 0,
            });
        }
    }
    startCleanup() {
        this.cleanupTimer = setInterval(() => {
            this.cleanup().catch(() => { });
        }, this.config.healthCheckIntervalMs);
        // Avoid keeping the process alive just for cleanup
        if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
            this.cleanupTimer.unref();
        }
    }
}
//# sourceMappingURL=QUICConnectionPool.js.map