/**
 * GraphTransformerService — ADR-060 Phase 3
 *
 * Thin service wrapping @ruvector/graph-transformer for use by controllers.
 * Provides 8 verified graph attention modules with graceful JS fallback.
 *
 * Module map:
 *   1. sublinearAttention   — replaces JS fallback in AttentionService
 *   2. verifiedStep         — extends LearningSystem
 *   3. causalAttention      — extends CausalRecall
 *   4. grangerExtract       — time-series causal discovery
 *   5. hamiltonianStep      — physics-informed agent trajectory
 *   6. spikingAttention     — biological, for ReflexionMemory
 *   7. gameTheoreticAttention — economic, for multi-agent routing
 *   8. productManifoldDistance — manifold, for ReasoningBank
 *
 * All methods return JS fallback results when the native module is not
 * available, so callers never need to check availability before use.
 */
export interface GraphTransformerStats {
    available: boolean;
    engineType: 'native' | 'wasm' | 'js';
    modulesLoaded: string[];
}
export declare class GraphTransformerService {
    private gt;
    private available;
    private engineType;
    initialize(): Promise<void>;
    isAvailable(): boolean;
    getEngineType(): 'native' | 'wasm' | 'js';
    getStats(): GraphTransformerStats;
    sublinearAttention(query: number[], adjacency: number[][], dim: number, topK: number): {
        scores: number[];
        indices: number[];
    };
    verifiedStep(weights: number[], gradients: number[], lr: number): {
        updated: number[];
        proofId?: number;
    };
    causalAttention(query: number[], keys: number[][], timestamps: number[]): {
        scores: number[];
        causalWeights: number[];
    };
    grangerExtract(history: number[], numNodes: number, numSteps: number): {
        edges: Array<{
            from: number;
            to: number;
            strength: number;
        }>;
    };
    hamiltonianStep(positions: number[], momenta: number[], dt: number): {
        newPositions: number[];
        newMomenta: number[];
        energy: number;
    };
    spikingAttention(potentials: number[], edges: number[][], threshold: number): {
        spikes: boolean[];
        activations: number[];
    };
    gameTheoreticAttention(utilities: number[], edges: Array<{
        from: number;
        to: number;
        weight: number;
    }>): {
        equilibrium: number[];
        nashScore: number;
    };
    productManifoldDistance(a: number[], b: number[], curvatures: number[]): {
        distance: number;
        components: number[];
    };
    proveDimension(expected: number, actual: number): {
        verified: boolean;
        proof_id?: number;
    };
    createAttestation(proofId: number): Uint8Array | null;
    verifyAttestation(bytes: Uint8Array): boolean;
}
//# sourceMappingURL=GraphTransformerService.d.ts.map