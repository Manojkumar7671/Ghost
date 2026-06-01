/**
 * RuVectorBackend - High-Performance Vector Storage (v0.1.99+)
 *
 * Implements VectorBackend using ruvector with native SIMD and multi-threading.
 * Updated for ruvector 0.1.99+ async API with object-style insert/search.
 *
 * Features:
 * - Native SIMD acceleration (2-4x faster vector ops)
 * - Automatic fallback when ruvector packages not installed
 * - Separate metadata storage for rich queries
 * - Score-to-similarity conversion for all metrics
 * - Batch operations for optimal throughput
 * - Parallel batch search via searchBatch()
 * - Persistent storage with separate metadata files
 */
import type { VectorBackend, VectorConfig, SearchResult, SearchOptions, VectorStats } from '../VectorBackend.js';
import type { RuVectorLearning } from './RuVectorLearning.js';
export declare class RuVectorBackend implements VectorBackend {
    readonly name: "ruvector";
    private db;
    private config;
    private metadata;
    private initialized;
    private learning;
    private nativeVersion;
    private isNativeImpl;
    constructor(config: VectorConfig);
    /**
     * Initialize RuVector database with SIMD and multi-threading (0.1.99+)
     */
    initialize(): Promise<void>;
    /**
     * Insert single vector with optional metadata.
     * Uses ruvector 0.1.99+ object-style API: insert({ id, vector, metadata? })
     */
    insert(id: string, embedding: Float32Array, metadata?: Record<string, any>): void;
    /**
     * Batch insert for optimal performance.
     * Uses ruvector 0.1.99+ insertBatch([{ id, vector, metadata? }])
     */
    insertBatch(items: Array<{
        id: string;
        embedding: Float32Array;
        metadata?: Record<string, any>;
    }>): void;
    /**
     * Set a RuVectorLearning instance for GNN-enhanced search
     */
    setLearning(learning: RuVectorLearning | null): void;
    /**
     * Get the current RuVectorLearning instance, if any
     */
    getLearning(): RuVectorLearning | null;
    /**
     * Search for k-nearest neighbors with optional filtering and GNN enhancement.
     * Uses ruvector 0.1.99+ search({ vector, k, efSearch?, filter? })
     * Results contain { id, score, vector?, metadata? }
     */
    search(query: Float32Array, k: number, options?: SearchOptions): SearchResult[];
    /**
     * Batch search for parallel query processing (0.1.99+).
     * Executes multiple searches concurrently for throughput.
     */
    searchBatch(queries: Float32Array[], k: number, options?: SearchOptions): Promise<SearchResult[][]>;
    /**
     * Remove vector by ID.
     * Uses ruvector 0.1.99+ delete(id) instead of remove(id)
     */
    remove(id: string): boolean;
    /**
     * Get database statistics including native SIMD status
     */
    getStats(): VectorStats;
    /**
     * Get extended stats including SIMD and version info
     */
    getExtendedStats(): {
        count: number;
        dimension: number;
        metric: string;
        backend: string;
        nativeVersion: string;
        isNative: boolean;
        simdEnabled: boolean;
    };
    /**
     * Save index and metadata to disk
     */
    save(path: string): Promise<void>;
    /**
     * Load index and metadata from disk
     */
    load(path: string): Promise<void>;
    /**
     * Close and cleanup resources
     */
    close(): void;
    /**
     * Convert score to distance for backward compatibility.
     * ruvector 0.1.99+ returns scores (higher = more similar).
     */
    private scoreToDistance;
    /**
     * Ensure database is initialized before operations
     */
    private ensureInitialized;
}
//# sourceMappingURL=RuVectorBackend.d.ts.map