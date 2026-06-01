/**
 * WASMVectorSearch - High-Performance Vector Operations
 *
 * Accelerates vector similarity search using ReasoningBank WASM module.
 * Provides 10-50x speedup for cosine similarity calculations compared to pure JS.
 *
 * Features:
 * - WASM-accelerated similarity search
 * - Batch vector operations
 * - Approximate nearest neighbors for large datasets
 * - Graceful fallback to JavaScript
 * - SIMD optimizations when available
 */
import type { AttentionService } from './AttentionService.js';
type Database = any;
export interface VectorSearchConfig {
    enableWASM: boolean;
    enableSIMD: boolean;
    batchSize: number;
    indexThreshold: number;
    /** Enable attention-enhanced search (ADR-064). Default: true */
    useAttention?: boolean;
}
export interface VectorSearchResult {
    id: number;
    distance: number;
    similarity: number;
    metadata?: any;
}
export interface VectorIndex {
    vectors: Float32Array[];
    ids: number[];
    metadata: any[];
    built: boolean;
    lastUpdate: number;
}
export declare class WASMVectorSearch {
    private db;
    private config;
    private wasmModule;
    private wasmAvailable;
    private simdAvailable;
    private vectorIndex;
    private attentionService;
    constructor(db: Database, config?: Partial<VectorSearchConfig>);
    /**
     * Set the AttentionService for attention-enhanced search (ADR-064).
     */
    setAttentionService(svc: AttentionService): void;
    /**
     * Initialize WASM module
     */
    private initializeWASM;
    /**
     * Detect SIMD support
     */
    private detectSIMD;
    /**
     * Calculate cosine similarity between two vectors (optimized)
     * Delegates to shared vector-math utility with 4x loop unrolling.
     */
    cosineSimilarity(a: Float32Array, b: Float32Array): number;
    /**
     * Batch calculate similarities between query and multiple vectors
     */
    batchSimilarity(query: Float32Array, vectors: Float32Array[]): number[];
    /**
     * Find k-nearest neighbors using brute force search
     */
    findKNN(query: Float32Array, k: number, tableName?: string, options?: {
        threshold?: number;
        filters?: Record<string, any>;
    }): Promise<VectorSearchResult[]>;
    /**
     * Build approximate nearest neighbor index for large datasets
     */
    buildIndex(vectors: Float32Array[], ids: number[], metadata?: any[]): void;
    /**
     * Search using ANN index (if available)
     */
    searchIndex(query: Float32Array, k: number, threshold?: number): VectorSearchResult[];
    /**
     * Attention-enhanced search (ADR-064 Phase 1).
     * Combines cosine similarity with Flash Attention scores for improved relevance.
     *
     * @param query      - Query vector
     * @param vectors    - Corpus of vectors with IDs and optional metadata
     * @param topK       - Number of results to return
     * @param useAttention - Override config to enable/disable attention scoring
     */
    searchWithAttention(query: number[], vectors: Array<{
        id: string;
        vector: number[];
        metadata?: any;
    }>, topK?: number, useAttention?: boolean): Promise<Array<{
        id: string;
        score: number;
        metadata?: any;
    }>>;
    /**
     * Basic cosine-only search (no attention).
     */
    private searchBasic;
    /**
     * Get vector search statistics
     */
    getStats(): {
        wasmAvailable: boolean;
        simdAvailable: boolean;
        indexBuilt: boolean;
        indexSize: number;
        lastIndexUpdate: number | null;
    };
    /**
     * Clear vector index
     */
    clearIndex(): void;
}
export {};
//# sourceMappingURL=WASMVectorSearch.d.ts.map