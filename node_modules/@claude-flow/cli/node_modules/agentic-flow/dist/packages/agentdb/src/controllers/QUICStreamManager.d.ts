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
import { QUICConnection } from './QUICConnection.js';
export type StreamPriority = 'urgent' | 'high' | 'normal' | 'low' | 'background';
export interface StreamConfig {
    priority?: StreamPriority;
    bidirectional?: boolean;
    maxSendWindow?: number;
    maxReceiveWindow?: number;
}
export interface StreamMetrics {
    streamId: number;
    priority: StreamPriority;
    bytesSent: number;
    bytesReceived: number;
    state: StreamState;
    createdAt: number;
    lastActiveAt: number;
    sendWindowRemaining: number;
    receiveWindowRemaining: number;
}
export interface ManagerStats {
    totalStreams: number;
    activeStreams: number;
    closedStreams: number;
    totalBytesSent: number;
    totalBytesReceived: number;
    streamsByPriority: Record<StreamPriority, number>;
    avgThroughputBytesPerSec: number;
}
export type StreamState = 'idle' | 'open' | 'half_closed_local' | 'half_closed_remote' | 'closed';
export declare class QUICStreamManager {
    private connection;
    private streams;
    private nextStreamId;
    private maxConcurrentStreams;
    private defaultSendWindow;
    private defaultReceiveWindow;
    private totalBytesSent;
    private totalBytesReceived;
    private createdAt;
    constructor(connection: QUICConnection, options?: {
        maxConcurrentStreams?: number;
        defaultSendWindow?: number;
        defaultReceiveWindow?: number;
    });
    /**
     * Create a new stream with optional priority and flow control settings.
     */
    createStream(config?: StreamConfig): number;
    /**
     * Send data on a specific stream.
     * Respects flow control: blocks if send window is exhausted.
     */
    sendOnStream(streamId: number, data: Uint8Array): Promise<{
        bytesSent: number;
        rttMs: number;
    }>;
    /**
     * Send data on multiple streams concurrently using priority scheduling.
     * Higher-priority streams are sent first.
     */
    sendMultiple(messages: Array<{
        streamId: number;
        data: Uint8Array;
    }>): Promise<Array<{
        streamId: number;
        bytesSent: number;
        rttMs: number;
    }>>;
    /**
     * Receive data on a stream (simulate receiving from remote).
     */
    receiveOnStream(streamId: number, data: Uint8Array): void;
    /**
     * Close a stream (half-close local side).
     */
    closeStream(streamId: number): void;
    /**
     * Reset a stream (abrupt close with error).
     */
    resetStream(streamId: number): void;
    /**
     * Get metrics for a specific stream.
     */
    getStreamMetrics(streamId: number): StreamMetrics;
    /**
     * Get overall manager statistics.
     */
    getStats(): ManagerStats;
    /**
     * Update the priority of an existing stream.
     */
    updatePriority(streamId: number, priority: StreamPriority): void;
    /**
     * Close all streams and reset state.
     */
    closeAll(): number;
    /**
     * Get the number of active (non-closed) streams.
     */
    getActiveStreamCount(): number;
    private getStream;
    private waitForSendWindow;
}
//# sourceMappingURL=QUICStreamManager.d.ts.map