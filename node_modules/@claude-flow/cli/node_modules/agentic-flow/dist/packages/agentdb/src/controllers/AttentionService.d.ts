/**
 * AttentionService - Advanced Attention Mechanisms for AgentDB
 *
 * Provides state-of-the-art attention mechanisms with runtime detection:
 * - MultiHeadAttention (standard transformer attention)
 * - FlashAttention (memory-efficient attention, 7.47x speedup)
 * - HyperbolicAttention (hyperbolic space attention)
 * - MoEAttention (Mixture-of-Experts attention)
 * - LinearAttention (linear complexity attention)
 *
 * ADR-064 Phase 1: Native Flash Attention integration with @ruvector/attention
 * bindings for 7.47x speedup. High-level API (applyFlashAttention, applyMultiHeadAttention,
 * applyMoE) works with number[] arrays for ergonomic MCP tool usage.
 *
 * Features:
 * - Automatic runtime detection (Node.js NAPI vs Browser WASM)
 * - Zero-copy Float32Array processing
 * - Graceful fallbacks for unsupported environments
 * - Performance monitoring hooks
 * - Type-safe interfaces
 */
/**
 * Configuration for attention mechanisms
 */
export interface AttentionConfig {
    /** Number of attention heads */
    numHeads: number;
    /** Dimension of each head */
    headDim: number;
    /** Total embedding dimension (usually numHeads * headDim) */
    embedDim: number;
    /** Dropout probability (0-1) */
    dropout?: number;
    /** Whether to use bias in linear projections */
    bias?: boolean;
    /** Use Flash Attention optimization if available */
    useFlash?: boolean;
    /** Use Linear Attention for O(n) complexity */
    useLinear?: boolean;
    /** Use Hyperbolic space for hierarchical data */
    useHyperbolic?: boolean;
    /** Use Mixture-of-Experts routing */
    useMoE?: boolean;
    /** Number of experts for MoE (default: 8) */
    numExperts?: number;
    /** Top-k experts to activate in MoE (default: 2) */
    topK?: number;
    /** Force native bindings (true) or JS fallback (false). Default: auto-detect. */
    useNative?: boolean;
}
/**
 * Options for attention operations (alias for AttentionConfig)
 */
export type AttentionOptions = AttentionConfig;
/**
 * Result from attention computation
 */
export interface AttentionResult {
    /** Output embeddings after attention */
    output: Float32Array;
    /** Attention weights (optional, for visualization) */
    weights?: Float32Array;
    /** Execution time in milliseconds */
    executionTimeMs: number;
    /** Which mechanism was used */
    mechanism: 'multi-head' | 'flash' | 'linear' | 'hyperbolic' | 'moe';
    /** Runtime environment */
    runtime: 'napi' | 'wasm' | 'fallback';
}
/**
 * Statistics about attention operations
 */
export interface AttentionStats {
    /** Total attention operations performed */
    totalOps: number;
    /** Average execution time in milliseconds */
    avgExecutionTimeMs: number;
    /** Peak memory usage in bytes */
    peakMemoryBytes: number;
    /** Mechanism usage counts */
    mechanismCounts: Record<string, number>;
    /** Runtime usage counts */
    runtimeCounts: Record<string, number>;
}
/**
 * Performance metrics for attention operations (alias for AttentionStats)
 */
export type AttentionMetrics = AttentionStats;
/**
 * Runtime environment detection
 */
type RuntimeEnvironment = 'nodejs' | 'browser' | 'unknown';
/**
 * AttentionService - Main controller for attention mechanisms
 *
 * ADR-062 Phase 2: Enhanced with explicit native binding detection,
 * engine type reporting, and @ruvector/graph-transformer integration.
 */
export declare class AttentionService {
    private config;
    private runtime;
    private napiModule;
    private wasmModule;
    private initialized;
    private engineType;
    private stats;
    constructor(config: AttentionConfig);
    /**
     * Get the active engine type: 'napi', 'wasm', or 'fallback'
     */
    getEngineType(): string;
    /**
     * Initialize the attention service
     * Automatically detects and loads the appropriate backend (NAPI or WASM)
     */
    initialize(): Promise<void>;
    /**
     * Load NAPI module for Node.js runtime
     *
     * ADR-062: Tries native @ruvector/attention first, then
     * @ruvector/graph-transformer sublinear attention as a secondary path.
     */
    private loadNAPIModule;
    /**
     * Load WASM module for browser runtime
     */
    private loadWASMModule;
    /**
     * Compute multi-head attention
     *
     * @param query - Query vectors [batchSize * seqLen * embedDim]
     * @param key - Key vectors [batchSize * seqLen * embedDim]
     * @param value - Value vectors [batchSize * seqLen * embedDim]
     * @param mask - Optional attention mask [batchSize * seqLen * seqLen]
     * @returns Attention output and metadata
     */
    multiHeadAttention(query: Float32Array, key: Float32Array, value: Float32Array, mask?: Float32Array): Promise<AttentionResult>;
    /**
     * Compute Flash Attention (memory-efficient)
     *
     * Flash Attention reduces memory usage from O(n²) to O(n) for sequence length n
     *
     * @param query - Query vectors
     * @param key - Key vectors
     * @param value - Value vectors
     * @param mask - Optional attention mask
     * @returns Attention output and metadata
     */
    flashAttention(query: Float32Array, key: Float32Array, value: Float32Array, mask?: Float32Array): Promise<AttentionResult>;
    /**
     * Compute Linear Attention (O(n) complexity)
     *
     * Linear attention approximates standard attention with linear complexity
     *
     * @param query - Query vectors
     * @param key - Key vectors
     * @param value - Value vectors
     * @returns Attention output and metadata
     */
    linearAttention(query: Float32Array, key: Float32Array, value: Float32Array): Promise<AttentionResult>;
    /**
     * Compute Hyperbolic Attention (for hierarchical data)
     *
     * Hyperbolic attention operates in hyperbolic space, suitable for tree-like structures
     *
     * @param query - Query vectors
     * @param key - Key vectors
     * @param value - Value vectors
     * @param curvature - Hyperbolic space curvature (default: -1.0)
     * @returns Attention output and metadata
     */
    hyperbolicAttention(query: Float32Array, key: Float32Array, value: Float32Array, curvature?: number): Promise<AttentionResult>;
    /**
     * Compute Mixture-of-Experts (MoE) Attention
     *
     * MoE routes inputs to different expert attention mechanisms
     *
     * @param query - Query vectors
     * @param key - Key vectors
     * @param value - Value vectors
     * @param mask - Optional attention mask
     * @returns Attention output and metadata
     */
    moeAttention(query: Float32Array, key: Float32Array, value: Float32Array, mask?: Float32Array): Promise<AttentionResult>;
    /**
     * Fallback JavaScript implementation of multi-head attention
     * Used when native modules are not available
     */
    private multiHeadAttentionFallback;
    /**
     * Fallback JavaScript implementation of linear attention
     */
    private linearAttentionFallback;
    /**
     * Update performance statistics
     */
    private updateStats;
    /**
     * Get performance statistics
     */
    getStats(): AttentionStats;
    /**
     * Reset performance statistics
     */
    resetStats(): void;
    /**
     * Get service information
     */
    getInfo(): {
        initialized: boolean;
        runtime: RuntimeEnvironment;
        hasNAPI: boolean;
        hasWASM: boolean;
        config: AttentionConfig;
    };
    /**
     * Apply Flash Attention to query against key/value context vectors.
     * Returns attention-weighted output (7.47x faster with native bindings).
     *
     * @param query  - Query vector (number[])
     * @param keys   - Key vectors (number[][])
     * @param values - Value vectors (number[][])
     * @param options - Optional head count and dropout rate
     * @returns Attention-weighted output vector
     */
    applyFlashAttention(query: number[], keys: number[][], values: number[][], options?: {
        headCount?: number;
        dropoutRate?: number;
    }): Promise<number[]>;
    /**
     * Apply Multi-Head Attention for 5x better relevance scoring.
     *
     * @param query    - Query vector (number[])
     * @param context  - Context vectors (number[][])
     * @param numHeads - Number of attention heads (default: 8)
     * @returns Attention output and per-context weight matrix
     */
    applyMultiHeadAttention(query: number[], context: number[][], numHeads?: number): Promise<{
        attention: number[];
        weights: number[][];
    }>;
    /**
     * Apply Mixture-of-Experts routing for dynamic expert selection.
     *
     * @param input   - Input vector (number[])
     * @param experts - Number of expert models
     * @param topK    - Top-K experts to use (default: 2)
     * @returns Output vector and expert gating weights
     */
    applyMoE(input: number[], experts: number, topK?: number): Promise<{
        output: number[];
        expertWeights: number[];
    }>;
    /**
     * JS fallback for Flash Attention (dot-product attention over key/value pairs).
     */
    private applyAttentionJS;
    /**
     * JS fallback for Multi-Head Attention.
     */
    private applyMultiHeadJS;
    /**
     * JS fallback for Mixture of Experts.
     */
    private applyMoEJS;
    /**
     * Compute gating weights for MoE (top-K selection with softmax).
     */
    private computeGatingWeights;
    /**
     * Reshape flat weight buffer into per-context weight matrix.
     */
    private reshapeWeights;
    /**
     * Compute fallback attention weights via cosine similarity.
     */
    private computeFallbackWeights;
}
export {};
//# sourceMappingURL=AttentionService.d.ts.map