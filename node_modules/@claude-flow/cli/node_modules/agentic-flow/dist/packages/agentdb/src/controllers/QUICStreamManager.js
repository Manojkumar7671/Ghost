/**
 * QUICStreamManager - Stream Multiplexing for QUIC Connections
 *
 * Manages multiple concurrent streams over a single QUIC connection:
 * - Stream multiplexing with independent flow control per stream
 * - Priority-based scheduling (urgent, high, normal, low, background)
 * - Bidirectional and unidirectional streams
 * - Flow control with configurable window sizes
 * - Stream-level metrics and backpressure
 */
const PRIORITY_WEIGHTS = {
    urgent: 256,
    high: 128,
    normal: 64,
    low: 32,
    background: 16,
};
export class QUICStreamManager {
    connection;
    streams = new Map();
    nextStreamId = 0;
    maxConcurrentStreams;
    defaultSendWindow;
    defaultReceiveWindow;
    totalBytesSent = 0;
    totalBytesReceived = 0;
    createdAt;
    constructor(connection, options) {
        this.connection = connection;
        this.maxConcurrentStreams = options?.maxConcurrentStreams ?? 100;
        this.defaultSendWindow = options?.defaultSendWindow ?? 65536;
        this.defaultReceiveWindow = options?.defaultReceiveWindow ?? 65536;
        this.createdAt = Date.now();
    }
    /**
     * Create a new stream with optional priority and flow control settings.
     */
    createStream(config) {
        const activeCount = this.getActiveStreamCount();
        if (activeCount >= this.maxConcurrentStreams) {
            throw new Error(`Maximum concurrent streams reached (${this.maxConcurrentStreams})`);
        }
        const streamId = this.nextStreamId++;
        const stream = {
            id: streamId,
            priority: config?.priority ?? 'normal',
            bidirectional: config?.bidirectional ?? true,
            state: 'open',
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            bytesSent: 0,
            bytesReceived: 0,
            sendWindow: config?.maxSendWindow ?? this.defaultSendWindow,
            maxSendWindow: config?.maxSendWindow ?? this.defaultSendWindow,
            receiveWindow: config?.maxReceiveWindow ?? this.defaultReceiveWindow,
            maxReceiveWindow: config?.maxReceiveWindow ?? this.defaultReceiveWindow,
            sendBuffer: [],
            receiveBuffer: [],
        };
        this.streams.set(streamId, stream);
        return streamId;
    }
    /**
     * Send data on a specific stream.
     * Respects flow control: blocks if send window is exhausted.
     */
    async sendOnStream(streamId, data) {
        const stream = this.getStream(streamId);
        if (stream.state === 'closed' || stream.state === 'half_closed_local') {
            throw new Error(`Stream ${streamId} is not writable (state: ${stream.state})`);
        }
        // Flow control: check send window
        if (data.length > stream.sendWindow) {
            // Wait for window update (simulated)
            await this.waitForSendWindow(stream, data.length);
        }
        // Consume send window
        stream.sendWindow -= data.length;
        stream.bytesSent += data.length;
        stream.lastActiveAt = Date.now();
        this.totalBytesSent += data.length;
        // Send via underlying connection
        const result = await this.connection.send(data);
        // Replenish send window (ACK-based)
        stream.sendWindow = Math.min(stream.sendWindow + data.length, stream.maxSendWindow);
        return { bytesSent: data.length, rttMs: result.rttMs };
    }
    /**
     * Send data on multiple streams concurrently using priority scheduling.
     * Higher-priority streams are sent first.
     */
    async sendMultiple(messages) {
        // Sort by priority (highest first)
        const sorted = messages
            .map(msg => ({
            ...msg,
            priority: this.getStream(msg.streamId).priority,
        }))
            .sort((a, b) => PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority]);
        // Send in priority order, but concurrently within same priority tier
        const results = [];
        let currentPriority = sorted[0]?.priority;
        let batch = [];
        for (const msg of sorted) {
            if (msg.priority !== currentPriority) {
                // Send current batch concurrently
                const batchResults = await Promise.all(batch.map(m => this.sendOnStream(m.streamId, m.data)
                    .then(r => ({ streamId: m.streamId, ...r }))));
                results.push(...batchResults);
                batch = [];
                currentPriority = msg.priority;
            }
            batch.push(msg);
        }
        // Send remaining batch
        if (batch.length > 0) {
            const batchResults = await Promise.all(batch.map(m => this.sendOnStream(m.streamId, m.data)
                .then(r => ({ streamId: m.streamId, ...r }))));
            results.push(...batchResults);
        }
        return results;
    }
    /**
     * Receive data on a stream (simulate receiving from remote).
     */
    receiveOnStream(streamId, data) {
        const stream = this.getStream(streamId);
        if (stream.state === 'closed' || stream.state === 'half_closed_remote') {
            throw new Error(`Stream ${streamId} is not readable (state: ${stream.state})`);
        }
        if (!stream.bidirectional) {
            throw new Error(`Stream ${streamId} is unidirectional`);
        }
        if (data.length > stream.receiveWindow) {
            throw new Error(`Flow control violation on stream ${streamId}: ` +
                `${data.length} bytes exceeds window ${stream.receiveWindow}`);
        }
        stream.receiveWindow -= data.length;
        stream.bytesReceived += data.length;
        stream.lastActiveAt = Date.now();
        stream.receiveBuffer.push(data);
        this.totalBytesReceived += data.length;
        // Auto window update when 50% consumed
        if (stream.receiveWindow < stream.maxReceiveWindow / 2) {
            stream.receiveWindow = stream.maxReceiveWindow;
        }
    }
    /**
     * Close a stream (half-close local side).
     */
    closeStream(streamId) {
        const stream = this.getStream(streamId);
        if (stream.state === 'open') {
            stream.state = 'half_closed_local';
        }
        else if (stream.state === 'half_closed_remote') {
            stream.state = 'closed';
        }
    }
    /**
     * Reset a stream (abrupt close with error).
     */
    resetStream(streamId) {
        const stream = this.getStream(streamId);
        stream.state = 'closed';
        stream.sendBuffer = [];
        stream.receiveBuffer = [];
    }
    /**
     * Get metrics for a specific stream.
     */
    getStreamMetrics(streamId) {
        const stream = this.getStream(streamId);
        return {
            streamId: stream.id,
            priority: stream.priority,
            bytesSent: stream.bytesSent,
            bytesReceived: stream.bytesReceived,
            state: stream.state,
            createdAt: stream.createdAt,
            lastActiveAt: stream.lastActiveAt,
            sendWindowRemaining: stream.sendWindow,
            receiveWindowRemaining: stream.receiveWindow,
        };
    }
    /**
     * Get overall manager statistics.
     */
    getStats() {
        const activeStreams = this.getActiveStreamCount();
        const closedStreams = Array.from(this.streams.values())
            .filter(s => s.state === 'closed').length;
        const byPriority = {
            urgent: 0, high: 0, normal: 0, low: 0, background: 0,
        };
        for (const stream of this.streams.values()) {
            if (stream.state !== 'closed') {
                byPriority[stream.priority]++;
            }
        }
        const elapsedSec = Math.max(1, (Date.now() - this.createdAt) / 1000);
        const avgThroughput = this.totalBytesSent / elapsedSec;
        return {
            totalStreams: this.streams.size,
            activeStreams,
            closedStreams,
            totalBytesSent: this.totalBytesSent,
            totalBytesReceived: this.totalBytesReceived,
            streamsByPriority: byPriority,
            avgThroughputBytesPerSec: Number(avgThroughput.toFixed(2)),
        };
    }
    /**
     * Update the priority of an existing stream.
     */
    updatePriority(streamId, priority) {
        const stream = this.getStream(streamId);
        stream.priority = priority;
    }
    /**
     * Close all streams and reset state.
     */
    closeAll() {
        let closed = 0;
        for (const stream of this.streams.values()) {
            if (stream.state !== 'closed') {
                stream.state = 'closed';
                closed++;
            }
        }
        return closed;
    }
    /**
     * Get the number of active (non-closed) streams.
     */
    getActiveStreamCount() {
        let count = 0;
        for (const stream of this.streams.values()) {
            if (stream.state !== 'closed') {
                count++;
            }
        }
        return count;
    }
    // -- Private helpers --
    getStream(streamId) {
        const stream = this.streams.get(streamId);
        if (!stream) {
            throw new Error(`Stream ${streamId} not found`);
        }
        return stream;
    }
    async waitForSendWindow(stream, needed) {
        const maxWait = 5000;
        const start = Date.now();
        while (stream.sendWindow < needed && (Date.now() - start) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 1));
            // Simulate window update from ACKs
            stream.sendWindow = Math.min(stream.sendWindow + Math.floor(stream.maxSendWindow / 4), stream.maxSendWindow);
        }
        if (stream.sendWindow < needed) {
            throw new Error(`Send window timeout on stream ${stream.id}: ` +
                `needed ${needed}, available ${stream.sendWindow}`);
        }
    }
}
//# sourceMappingURL=QUICStreamManager.js.map