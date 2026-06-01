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
import { cosineSimilarity } from '../utils/vector-math.js';
export class GraphTransformerService {
    gt = null;
    available = false;
    engineType = 'js';
    async initialize() {
        // Try native NAPI-RS first
        try {
            const { GraphTransformer } = await import('@ruvector/graph-transformer');
            this.gt = new GraphTransformer();
            this.available = true;
            this.engineType = 'native';
            return;
        }
        catch { /* native not available */ }
        // Try WASM fallback
        try {
            const mod = await import('ruvector-graph-transformer-wasm');
            if (typeof mod.default === 'function')
                await mod.default();
            this.gt = new mod.JsGraphTransformer();
            this.available = true;
            this.engineType = 'wasm';
            return;
        }
        catch { /* WASM not available */ }
        // Pure JS fallback
        this.engineType = 'js';
        this.available = false;
    }
    isAvailable() {
        return this.available;
    }
    getEngineType() {
        return this.engineType;
    }
    getStats() {
        const modules = this.available
            ? ['sublinearAttention', 'verifiedStep', 'causalAttention', 'grangerExtract',
                'hamiltonianStep', 'spikingAttention', 'gameTheoreticAttention', 'productManifoldDistance']
            : [];
        return { available: this.available, engineType: this.engineType, modulesLoaded: modules };
    }
    // -------------------------------------------------------------------------
    // 1. Sublinear Attention — replaces JS fallback in AttentionService
    // -------------------------------------------------------------------------
    sublinearAttention(query, adjacency, dim, topK) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.sublinearAttention
                    : this.gt.sublinear_attention;
                if (typeof fn === 'function') {
                    const result = fn.call(this.gt, query, adjacency, dim, topK);
                    // Normalize native response which may have different structure
                    if (result && typeof result === 'object') {
                        if ('scores' in result && 'indices' in result) {
                            return result;
                        }
                        // Native may return { topScores, topIndices }
                        if ('topScores' in result && 'topIndices' in result) {
                            return { scores: result.topScores, indices: result.topIndices };
                        }
                    }
                }
            }
            catch { /* fall through to JS */ }
        }
        // JS fallback: compute cosine similarity of query against each row
        const scores = adjacency.map(row => cosineSimilarity(query, row));
        const indexed = scores.map((s, i) => ({ s, i }));
        indexed.sort((a, b) => b.s - a.s);
        const topIndices = indexed.slice(0, topK).map(x => x.i);
        const topScores = indexed.slice(0, topK).map(x => x.s);
        return { scores: topScores, indices: topIndices };
    }
    // -------------------------------------------------------------------------
    // 2. Verified Training Step — extends LearningSystem
    // -------------------------------------------------------------------------
    verifiedStep(weights, gradients, lr) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.verifiedStep
                    : this.gt.verified_step;
                if (typeof fn === 'function') {
                    const result = fn.call(this.gt, weights, gradients, lr);
                    // Native result might be an object with various keys
                    if (result && typeof result === 'object' && !Array.isArray(result)) {
                        // Check all possible response formats
                        const updated = result.updated || result.updatedWeights || result.weights || result.newWeights;
                        const proofId = result.proofId || result.proof_id;
                        if (updated) {
                            return { updated, proofId };
                        }
                    }
                    // Or may return array directly
                    if (Array.isArray(result)) {
                        return { updated: result };
                    }
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: simple SGD
        const updated = weights.map((w, i) => w - lr * (gradients[i] ?? 0));
        return { updated };
    }
    // -------------------------------------------------------------------------
    // 3. Causal Attention — extends CausalRecall
    // -------------------------------------------------------------------------
    causalAttention(query, keys, timestamps) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.causalAttention
                    : this.gt.causal_attention;
                if (typeof fn === 'function') {
                    const result = fn.call(this.gt, query, keys, timestamps);
                    // Check if result is already in correct format
                    if (result && typeof result === 'object' && !Array.isArray(result)) {
                        if ('scores' in result || 'causalWeights' in result) {
                            const scores = result.scores || result.attention || [];
                            const causalWeights = result.causalWeights || result.causal_weights || result.weights || scores;
                            return { scores, causalWeights };
                        }
                    }
                    // Native may return array directly
                    if (Array.isArray(result)) {
                        return { scores: result, causalWeights: result.map((s) => Math.max(0, s)) };
                    }
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: similarity with temporal decay
        const now = Math.max(...timestamps, 1);
        const scores = keys.map((k, i) => {
            const sim = cosineSimilarity(query, k);
            const age = (now - timestamps[i]) / now;
            return sim * Math.exp(-0.1 * age);
        });
        return { scores, causalWeights: scores.map(s => Math.max(0, s)) };
    }
    // -------------------------------------------------------------------------
    // 4. Granger Extract — time-series causal discovery
    // -------------------------------------------------------------------------
    grangerExtract(history, numNodes, numSteps) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.grangerExtract
                    : this.gt.granger_extract;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, history, numNodes, numSteps);
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: simple correlation-based edges
        const edges = [];
        const stride = Math.floor(history.length / numNodes);
        for (let i = 0; i < numNodes; i++) {
            for (let j = i + 1; j < numNodes; j++) {
                const aSlice = history.slice(i * stride, (i + 1) * stride);
                const bSlice = history.slice(j * stride, (j + 1) * stride);
                if (aSlice.length > 0 && bSlice.length > 0) {
                    const strength = Math.abs(cosineSimilarity(aSlice, bSlice));
                    if (strength > 0.3) {
                        edges.push({ from: i, to: j, strength });
                    }
                }
            }
        }
        return { edges };
    }
    // -------------------------------------------------------------------------
    // 5. Hamiltonian Step — physics-informed agent trajectory
    // -------------------------------------------------------------------------
    hamiltonianStep(positions, momenta, dt) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.hamiltonianStep
                    : this.gt.hamiltonian_step;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, positions, momenta, dt);
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: leapfrog integrator
        const n = positions.length;
        const newMomenta = momenta.slice();
        const newPositions = positions.slice();
        // Half-step momenta (assume harmonic potential V = 0.5 * sum(x^2))
        for (let i = 0; i < n; i++) {
            newMomenta[i] -= 0.5 * dt * positions[i];
        }
        // Full-step positions
        for (let i = 0; i < n; i++) {
            newPositions[i] += dt * newMomenta[i];
        }
        // Half-step momenta
        for (let i = 0; i < n; i++) {
            newMomenta[i] -= 0.5 * dt * newPositions[i];
        }
        // Energy = KE + PE
        let ke = 0, pe = 0;
        for (let i = 0; i < n; i++) {
            ke += 0.5 * newMomenta[i] * newMomenta[i];
            pe += 0.5 * newPositions[i] * newPositions[i];
        }
        return { newPositions, newMomenta, energy: ke + pe };
    }
    // -------------------------------------------------------------------------
    // 6. Spiking Attention — biological, for ReflexionMemory
    // -------------------------------------------------------------------------
    spikingAttention(potentials, edges, threshold) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.spikingAttention
                    : this.gt.spiking_attention;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, potentials, edges, threshold);
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: integrate-and-fire
        const n = potentials.length;
        const activations = potentials.slice();
        // Sum incoming edge weights
        for (let i = 0; i < n; i++) {
            if (edges[i]) {
                for (let j = 0; j < edges[i].length; j++) {
                    activations[i] += (edges[i][j] ?? 0) * 0.1;
                }
            }
        }
        const spikes = activations.map(a => a >= threshold);
        return { spikes, activations };
    }
    // -------------------------------------------------------------------------
    // 7. Game-Theoretic Attention — for multi-agent routing
    // -------------------------------------------------------------------------
    gameTheoreticAttention(utilities, edges) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.gameTheoreticAttention
                    : this.gt.game_theoretic_attention;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, utilities, edges);
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: softmax equilibrium
        const n = utilities.length;
        const maxU = Math.max(...utilities, 1e-10);
        const exp = utilities.map(u => Math.exp(u / maxU));
        const sum = exp.reduce((a, b) => a + b, 1e-10);
        const equilibrium = exp.map(e => e / sum);
        // Nash score: how uniform the equilibrium is (1 = pure strategy)
        const nashScore = 1 - (equilibrium.reduce((acc, p) => acc - (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(n || 2));
        return { equilibrium, nashScore: Math.max(0, Math.min(1, nashScore)) };
    }
    // -------------------------------------------------------------------------
    // 8. Product Manifold Distance — for ReasoningBank
    // -------------------------------------------------------------------------
    productManifoldDistance(a, b, curvatures) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.productManifoldDistance
                    : this.gt.product_manifold_distance;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, a, b, curvatures);
                }
            }
            catch { /* fall through */ }
        }
        // JS fallback: weighted Euclidean distance per curvature block
        const blockSize = Math.max(1, Math.floor(a.length / (curvatures.length || 1)));
        const components = [];
        let totalDist = 0;
        for (let c = 0; c < curvatures.length; c++) {
            const start = c * blockSize;
            const end = Math.min(start + blockSize, a.length);
            let blockDist = 0;
            for (let i = start; i < end; i++) {
                const diff = (a[i] ?? 0) - (b[i] ?? 0);
                blockDist += diff * diff;
            }
            const scale = 1 + Math.abs(curvatures[c]);
            blockDist = Math.sqrt(blockDist) * scale;
            components.push(blockDist);
            totalDist += blockDist * blockDist;
        }
        return { distance: Math.sqrt(totalDist), components };
    }
    // -------------------------------------------------------------------------
    // Proof operations
    // -------------------------------------------------------------------------
    proveDimension(expected, actual) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.proveDimension
                    : this.gt.prove_dimension;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, expected, actual);
                }
            }
            catch { /* fall through */ }
        }
        return { verified: expected === actual };
    }
    createAttestation(proofId) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.createAttestation
                    : this.gt.create_attestation;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, proofId);
                }
            }
            catch { /* fall through */ }
        }
        return null;
    }
    verifyAttestation(bytes) {
        if (this.available && this.gt) {
            try {
                const fn = this.engineType === 'native'
                    ? this.gt.verifyAttestation
                    : this.gt.verify_attestation;
                if (typeof fn === 'function') {
                    return fn.call(this.gt, bytes);
                }
            }
            catch { /* fall through */ }
        }
        return false;
    }
}
//# sourceMappingURL=GraphTransformerService.js.map