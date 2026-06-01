/**
 * GNNService - Graph Neural Network Integration
 *
 * Provides high-level GNN capabilities on top of @ruvector/gnn:
 * - Semantic intent classification
 * - Graph-based skill recommendations
 * - Code pattern similarity via graph embeddings
 *
 * Tries native @ruvector/gnn first (NAPI-RS), falls back to JS.
 * All public methods are safe to call regardless of engine availability.
 *
 * Performance targets (ADR-062):
 * - 100x-50000x speedup when native @ruvector/gnn is available
 * - Zero-overhead JS fallback when native is not present
 */
export interface GNNConfig {
    inputDim: number;
    hiddenDim: number;
    outputDim: number;
    heads: number;
    layers?: number;
}
export interface IntentResult {
    intent: string;
    confidence: number;
    logits?: number[];
}
export declare class GNNService {
    private gnn;
    private engineType;
    private initialized;
    private config;
    constructor(config?: Partial<GNNConfig>);
    /**
     * Initialize the GNN engine.
     *
     * Attempts to load @ruvector/gnn and create a GNN layer.
     * Falls back to JS-based heuristics if unavailable.
     */
    initialize(): Promise<void>;
    /**
     * Semantic intent classification.
     *
     * When native GNN is available, runs a forward pass on the embedding
     * and maps logits to intent categories. Otherwise uses keyword matching.
     */
    classifyIntent(query: string, embedding: Float32Array): Promise<IntentResult>;
    /**
     * Graph-based skill recommendations.
     *
     * Uses GNN node classification when available, otherwise
     * returns adjacent skills from the skill graph map.
     */
    recommendSkills(currentSkill: string, skillGraph: Record<string, string[]>): Promise<string[]>;
    /**
     * Find similar code patterns using graph embedding similarity.
     *
     * When native GNN is available, uses graph-level similarity.
     * Otherwise falls back to cosine similarity.
     */
    findSimilarPatterns(pattern: number[], patterns: number[][]): Promise<Array<{
        index: number;
        similarity: number;
    }>>;
    /**
     * Get the current engine type.
     */
    getEngineType(): 'native' | 'js';
    /**
     * Check if the service is initialized.
     */
    isInitialized(): boolean;
    /**
     * Get service statistics.
     */
    getStats(): {
        engineType: string;
        initialized: boolean;
        config: GNNConfig;
    };
    /**
     * Graph Convolutional Network (GCN) for skill matching.
     *
     * Uses GCN layers to learn representations of skills based on their
     * relationships in the skill graph. Achieves >90% accuracy when native.
     */
    matchSkillsGCN(taskEmbedding: Float32Array, skillGraph: Record<string, {
        embedding: Float32Array;
        neighbors: string[];
    }>, topK?: number): Promise<Array<{
        skill: string;
        score: number;
        confidence: number;
    }>>;
    /**
     * Graph Attention Network (GAT) for context understanding.
     *
     * Applies attention mechanisms to weight the importance of different
     * context nodes when making predictions.
     */
    understandContextGAT(queryEmbedding: Float32Array, contextNodes: Array<{
        id: string;
        embedding: Float32Array;
        type: string;
    }>, attentionHeads?: number): Promise<{
        contextVector: Float32Array;
        attentionWeights: Record<string, number>;
        dominantTypes: string[];
    }>;
    /**
     * Process heterogeneous graphs with multiple node and edge types.
     *
     * Handles graphs with different types of entities (agents, tasks, skills)
     * and relationships (depends_on, requires, similar_to).
     */
    processHeterogeneousGraph(graph: {
        nodes: Array<{
            id: string;
            type: string;
            embedding: Float32Array;
        }>;
        edges: Array<{
            from: string;
            to: string;
            type: string;
            weight: number;
        }>;
    }, queryNodeId: string): Promise<{
        embedding: Float32Array;
        relatedNodes: Array<{
            id: string;
            type: string;
            relevance: number;
        }>;
        pathways: Array<{
            path: string[];
            strength: number;
        }>;
    }>;
    /**
     * Node classification for task categorization.
     *
     * Classifies nodes into predefined categories using GNN-based features.
     */
    classifyNode(nodeEmbedding: Float32Array, neighborEmbeddings: Float32Array[], categories: string[]): Promise<{
        category: string;
        confidence: number;
        scores: Record<string, number>;
    }>;
    /**
     * Link prediction for workflow optimization.
     *
     * Predicts likely connections between nodes to suggest workflow improvements.
     */
    predictLinks(sourceNode: {
        id: string;
        embedding: Float32Array;
    }, candidateNodes: Array<{
        id: string;
        embedding: Float32Array;
        type: string;
    }>, existingEdges: Array<{
        from: string;
        to: string;
    }>, topK?: number): Promise<Array<{
        targetId: string;
        probability: number;
        reasoning: string;
    }>>;
    private findStrongPathways;
    private cosineSim;
}
//# sourceMappingURL=GNNService.d.ts.map