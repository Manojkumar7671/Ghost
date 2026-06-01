/**
 * CausalMemoryGraph - Causal Reasoning over Agent Memories
 *
 * Implements intervention-based reasoning rather than correlation.
 * Stores p(y|do(x)) estimates and tracks causal uplift across episodes.
 *
 * Based on:
 * - Pearl's do-calculus and causal inference
 * - Uplift modeling from A/B testing
 * - Instrumental variable methods
 *
 * v2.0.0-alpha.3 Features:
 * - HyperbolicAttention for tree-structured causal chain retrieval
 * - Poincaré embeddings for hierarchical relationships
 * - Feature flag: ENABLE_HYPERBOLIC_ATTENTION (default: false)
 * - 100% backward compatible with fallback to standard retrieval
 */
import { type HyperbolicAttentionConfig } from '../utils/LegacyAttentionAdapter.js';
import { EmbeddingService } from './EmbeddingService.js';
type Database = any;
/**
 * Configuration for CausalMemoryGraph
 */
export interface CausalMemoryGraphConfig {
    /** Enable hyperbolic attention for causal chains (default: false) */
    ENABLE_HYPERBOLIC_ATTENTION?: boolean;
    /** Hyperbolic attention configuration */
    hyperbolicConfig?: Partial<HyperbolicAttentionConfig>;
}
export interface CausalEdge {
    id?: number;
    fromMemoryId: number;
    fromMemoryType: 'episode' | 'skill' | 'note' | 'fact';
    toMemoryId: number;
    toMemoryType: 'episode' | 'skill' | 'note' | 'fact';
    similarity: number;
    uplift?: number;
    confidence: number;
    sampleSize?: number;
    evidenceIds?: string[];
    experimentIds?: string[];
    confounderScore?: number;
    mechanism?: string;
    metadata?: Record<string, any>;
}
export interface CausalExperiment {
    id?: number;
    name: string;
    hypothesis: string;
    treatmentId: number;
    treatmentType: string;
    controlId?: number;
    startTime: number;
    endTime?: number;
    sampleSize: number;
    treatmentMean?: number;
    controlMean?: number;
    uplift?: number;
    pValue?: number;
    confidenceIntervalLow?: number;
    confidenceIntervalHigh?: number;
    status: 'running' | 'completed' | 'failed';
    metadata?: Record<string, any>;
}
export interface CausalObservation {
    experimentId: number;
    episodeId: number;
    isTreatment: boolean;
    outcomeValue: number;
    outcomeType: 'reward' | 'success' | 'latency';
    context?: Record<string, any>;
}
export interface CausalQuery {
    interventionMemoryId: number;
    interventionMemoryType: string;
    outcomeMemoryId?: number;
    minConfidence?: number;
    minUplift?: number;
}
export declare class CausalMemoryGraph {
    private db;
    private graphBackend?;
    private attentionService?;
    private embedder?;
    private config;
    /**
     * Constructor supports both v1 (legacy) and v2 (with attention) modes
     *
     * v1 mode: new CausalMemoryGraph(db)
     * v2 mode: new CausalMemoryGraph(db, graphBackend, embedder, config)
     */
    constructor(db: Database, graphBackend?: any, embedder?: EmbeddingService, config?: CausalMemoryGraphConfig);
    /**
     * Add a causal edge between memories
     */
    addCausalEdge(edge: CausalEdge): Promise<number>;
    /**
     * Create a causal experiment (A/B test)
     */
    createExperiment(experiment: CausalExperiment): number;
    /**
     * Record an observation in an experiment
     */
    recordObservation(observation: CausalObservation): void;
    /**
     * Calculate uplift for an experiment
     */
    calculateUplift(experimentId: number): {
        uplift: number;
        pValue: number;
        confidenceInterval: [number, number];
    };
    /**
     * Query causal effects
     */
    queryCausalEffects(query: CausalQuery): CausalEdge[];
    /**
     * Get causal chain (multi-hop reasoning)
     *
     * v2: Uses HyperbolicAttention if enabled for tree-structured retrieval
     * v1: Falls back to recursive CTE with standard scoring
     *
     * @param fromMemoryId - Starting memory node
     * @param toMemoryId - Target memory node
     * @param maxDepth - Maximum chain depth (default: 5)
     * @returns Ranked causal chains with paths, uplift, and confidence
     */
    getCausalChain(fromMemoryId: number, toMemoryId: number, maxDepth?: number): Promise<{
        path: number[];
        totalUplift: number;
        confidence: number;
        attentionMetrics?: {
            hyperbolicDistance: number[];
            computeTimeMs: number;
        };
    }[]>;
    /**
     * Hash a string to a positive integer
     * Used for converting string IDs to numeric IDs for backward compatibility
     */
    private hashString;
    /**
     * Get causal chain with HyperbolicAttention (v2 feature)
     *
     * Uses Poincaré embeddings to model hierarchical causal relationships.
     * Retrieves chains based on hyperbolic distance in embedding space.
     *
     * @private
     */
    private getCausalChainWithAttention;
    /**
     * Calculate causal gain: E[outcome|do(treatment)] - E[outcome]
     */
    calculateCausalGain(treatmentId: number, outcomeType: 'reward' | 'success' | 'latency'): {
        causalGain: number;
        confidence: number;
        mechanism: string;
    };
    /**
     * Detect confounders using correlation analysis
     */
    detectConfounders(edgeId: number): {
        confounders: Array<{
            memoryId: number;
            correlationWithTreatment: number;
            correlationWithOutcome: number;
            confounderScore: number;
        }>;
    };
    private rowToCausalEdge;
    private mean;
    private variance;
    private standardError;
    private tCDF;
    private tInverse;
    private calculateCorrelation;
}
export {};
//# sourceMappingURL=CausalMemoryGraph.d.ts.map