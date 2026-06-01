/**
 * LegacyAttentionAdapter - Compatibility layer for deprecated services/AttentionService
 *
 * This module re-exports the legacy config types and provides a backward-compatible
 * AttentionService class that delegates to the production controllers/AttentionService.
 *
 * Created as part of ADR-056: consolidation of services/AttentionService into controllers.
 *
 * @module LegacyAttentionAdapter
 */
type Database = any;
export interface HyperbolicAttentionConfig {
    enabled: boolean;
    curvature?: number;
    dimension?: number;
    temperature?: number;
}
export interface FlashAttentionConfig {
    enabled: boolean;
    blockSize?: number;
    useSIMD?: boolean;
    maxSeqLen?: number;
}
export interface GraphRoPEConfig {
    enabled: boolean;
    maxHops?: number;
    rotaryDim?: number;
    baseFreq?: number;
}
export interface MoEAttentionConfig {
    enabled: boolean;
    numExperts?: number;
    topK?: number;
    expertDomains?: string[];
}
export interface HyperbolicAttentionResult {
    attended: Float32Array;
    weights: Float32Array;
    distances: number[];
    metrics: {
        computeTimeMs: number;
        memoryUsedMB: number;
    };
}
export interface FlashAttentionResult {
    output: Float32Array;
    scores?: Float32Array;
    metrics: {
        computeTimeMs: number;
        peakMemoryMB: number;
        blocksProcessed: number;
    };
}
export interface GraphRoPEResult {
    queries: Float32Array;
    keys: Float32Array;
    hopEncodings: Float32Array;
    metrics: {
        computeTimeMs: number;
    };
}
/**
 * Backward-compatible AttentionService that delegates to the production
 * controllers/AttentionService while maintaining the legacy constructor
 * and method signatures used by ExplainableRecall, NightlyLearner, and
 * CausalMemoryGraph.
 */
export declare class AttentionService {
    private delegate;
    private hyperbolicConfig;
    private flashConfig;
    private graphRoPEConfig;
    constructor(_db: Database, configs?: {
        hyperbolic?: Partial<HyperbolicAttentionConfig>;
        flash?: Partial<FlashAttentionConfig>;
        graphRoPE?: Partial<GraphRoPEConfig>;
        moe?: Partial<MoEAttentionConfig>;
    });
    hyperbolicAttention(queries: Float32Array, keys: Float32Array, values: Float32Array, hierarchyLevels: number[]): Promise<HyperbolicAttentionResult>;
    flashAttention(queries: Float32Array, keys: Float32Array, values: Float32Array): Promise<FlashAttentionResult>;
    graphRoPE(queries: Float32Array, keys: Float32Array, hopDistances: number[][]): Promise<GraphRoPEResult>;
    private fallbackHyperbolicAttention;
    private fallbackFlashAttention;
    private fallbackGraphRoPE;
    private softmax;
    getConfig(): {
        hyperbolic: HyperbolicAttentionConfig;
        flash: FlashAttentionConfig;
        graphRoPE: GraphRoPEConfig;
    };
}
export {};
//# sourceMappingURL=LegacyAttentionAdapter.d.ts.map