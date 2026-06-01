/**
 * RVFOptimizer - RuVector Format Optimization Patterns
 *
 * Implements RVF (RuVector Format) optimization patterns for AgentDB:
 * - Embedding compression via quantization (4/8/16-bit)
 * - Deduplication of near-identical embeddings
 * - Memory pruning based on confidence and age
 * - Batch embedding with configurable queue and timer
 * - LRU caching for frequently accessed embeddings
 * - 4-bit INT4 quantization for 8x memory compression (ADR-065)
 * - Adaptive quantization based on importance scores
 * - Progressive compression with automatic promotion/demotion
 * - Multi-level caching with zero-copy hot paths
 *
 * Performance targets (ADR-062, ADR-065):
 * - 10-100x speedup via batch embedding
 * - 8x memory reduction via 4-bit quantization (vs 4x with 8-bit)
 * - 20-50% storage reduction via deduplication
 * - <5% quality degradation with adaptive quantization
 */
export interface RVFConfig {
    compression: {
        enabled: boolean;
        quantizeBits: 4 | 8 | 16;
        deduplicationThreshold: number;
        adaptive: boolean;
        progressive: boolean;
    };
    pruning: {
        enabled: boolean;
        minConfidence: number;
        maxAge: number;
    };
    batching: {
        enabled: boolean;
        batchSize: number;
        maxWaitMs: number;
    };
    caching: {
        enabled: boolean;
        maxSize: number;
        ttl: number;
        multiLevel: boolean;
    };
}
export interface CompressionMetrics {
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    qualityScore: number;
    quantizationBits: 4 | 8 | 16;
    adaptiveBoost: number;
}
export interface CacheLevel {
    name: 'L1' | 'L2' | 'L3';
    maxSize: number;
    quantizeBits: 4 | 8 | 16;
    hitRate: number;
    entries: number;
}
export declare class RVFOptimizer {
    private config;
    private cache;
    private batchQueue;
    private batchTimer?;
    private l1Cache;
    private l2Cache;
    private l3Cache;
    private importanceScores;
    private compressionMetrics;
    private cacheStats;
    constructor(config?: Partial<RVFConfig>);
    /**
     * 4-bit INT4 quantization for 8x memory compression.
     *
     * ADR-065: Implements aggressive 4-bit quantization with:
     * - 16 levels per component (0-15)
     * - Min-max normalization per vector
     * - 8x compression ratio (32-bit → 4-bit)
     *
     * @returns Compressed embedding with quality metrics
     */
    quantize4Bit(embedding: number[]): {
        compressed: number[];
        metrics: CompressionMetrics;
    };
    /**
     * Adaptive quantization: adjust bit depth based on importance score.
     *
     * ADR-065: High-importance embeddings get higher bit depth:
     * - importance > 0.8: 16-bit (minimal quality loss)
     * - importance 0.5-0.8: 8-bit (balanced)
     * - importance < 0.5: 4-bit (max compression)
     */
    adaptiveQuantize(embedding: number[], importance?: number): {
        compressed: number[];
        metrics: CompressionMetrics;
    };
    /**
     * Progressive compression: automatically promote/demote based on access patterns.
     *
     * ADR-065: Multi-level caching:
     * - L1 (4-bit): Hot embeddings (accessed frequently)
     * - L2 (8-bit): Warm embeddings (moderate access)
     * - L3 (16-bit): Cold embeddings (rare access)
     *
     * Automatic promotion on cache hits, demotion on age.
     */
    progressiveCompress(key: string, embedding: number[], accessCount?: number): {
        compressed: number[];
        cacheLevel: 'L1' | 'L2' | 'L3';
        metrics: CompressionMetrics;
    };
    /**
     * Zero-copy compression using Int8Array for hot paths.
     *
     * ADR-065: For frequently accessed embeddings, use typed arrays
     * to avoid allocation overhead and enable SIMD optimizations.
     */
    zeroCopyCompress4Bit(embedding: Float32Array): Int8Array;
    /**
     * Measure quality degradation from compression.
     *
     * @returns Quality metrics: cosine similarity, MSE, max error
     */
    measureQuality(original: number[], compressed: number[]): {
        cosineSimilarity: number;
        mse: number;
        maxError: number;
    };
    /**
     * Get multi-level cache statistics.
     */
    getCacheLevels(): CacheLevel[];
    /**
     * Compress embeddings using quantization.
     *
     * Maps each component to an N-bit integer range then reconstructs
     * the approximate float value. This reduces memory per vector by
     * up to 8x (float32 -> 4-bit) while retaining search accuracy.
     */
    compressEmbedding(embedding: number[]): number[];
    /**
     * Compress a Float32Array embedding (zero-copy friendly).
     */
    compressFloat32(embedding: Float32Array): Float32Array;
    /**
     * Deduplicate similar embeddings by cosine similarity.
     *
     * Scans the list and removes items whose embedding is above
     * the deduplication threshold compared to an already-kept item.
     * Keeps the higher-confidence entry when duplicates are found.
     */
    deduplicate(embeddings: Array<{
        id: string;
        embedding: number[];
        confidence: number;
    }>): Array<{
        id: string;
        embedding: number[];
        confidence: number;
    }>;
    /**
     * Identify memories that should be pruned based on confidence and age.
     *
     * Returns an array of IDs that are below the minimum confidence
     * threshold or older than the maximum allowed age.
     */
    pruneMemories(memories: Array<{
        id: string;
        confidence: number;
        timestamp: number;
    }>): string[];
    /**
     * Batch embedding generation for 10-100x throughput improvement.
     *
     * Queues individual embed requests and flushes them either when
     * the batch reaches `batchSize` or after `maxWaitMs` milliseconds.
     * Uses the provided `embedFn` callback for the actual embedding.
     */
    batchEmbed(query: string, embedFn: (text: string) => Promise<number[]>): Promise<number[]>;
    /**
     * Flush any pending batch items immediately.
     */
    flush(embedFn: (text: string) => Promise<number[]>): Promise<void>;
    /**
     * Clear the embedding cache.
     */
    clearCache(): void;
    /**
     * Get optimizer statistics.
     */
    getStats(): {
        config: RVFConfig;
        cacheSize: number;
        batchQueueSize: number;
        multiLevelCache?: {
            l1: {
                size: number;
                hits: number;
                misses: number;
                hitRate: number;
            };
            l2: {
                size: number;
                hits: number;
                misses: number;
                hitRate: number;
            };
            l3: {
                size: number;
                hits: number;
                misses: number;
                hitRate: number;
            };
        };
        compressionMetrics?: {
            avgCompressionRatio: number;
            avgQualityScore: number;
            totalCompressed: number;
        };
    };
    private processBatch;
    private cosineSimilarity;
}
//# sourceMappingURL=RVFOptimizer.d.ts.map