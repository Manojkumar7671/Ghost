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
import { AttentionService as ControllersAttentionService } from '../controllers/AttentionService.js';
// ========================================================================
// Legacy AttentionService Adapter
// ========================================================================
/**
 * Backward-compatible AttentionService that delegates to the production
 * controllers/AttentionService while maintaining the legacy constructor
 * and method signatures used by ExplainableRecall, NightlyLearner, and
 * CausalMemoryGraph.
 */
export class AttentionService {
    delegate;
    hyperbolicConfig;
    flashConfig;
    graphRoPEConfig;
    constructor(_db, configs) {
        this.hyperbolicConfig = {
            enabled: false,
            curvature: 1.0,
            dimension: 384,
            temperature: 1.0,
            ...configs?.hyperbolic,
        };
        this.flashConfig = {
            enabled: false,
            blockSize: 256,
            useSIMD: true,
            maxSeqLen: 4096,
            ...configs?.flash,
        };
        this.graphRoPEConfig = {
            enabled: false,
            maxHops: 10,
            rotaryDim: 64,
            baseFreq: 10000,
            ...configs?.graphRoPE,
        };
        const dim = this.hyperbolicConfig.dimension ?? 384;
        this.delegate = new ControllersAttentionService({
            numHeads: 1,
            headDim: dim,
            embedDim: dim,
            useFlash: this.flashConfig.enabled,
            useHyperbolic: this.hyperbolicConfig.enabled,
        });
    }
    async hyperbolicAttention(queries, keys, values, hierarchyLevels) {
        const startTime = Date.now();
        const dim = this.hyperbolicConfig.dimension ?? 384;
        const numKeys = keys.length / dim;
        try {
            const result = await this.delegate.hyperbolicAttention(queries, keys, values, this.hyperbolicConfig.curvature ?? 1.0);
            const weights = result.weights ?? new Float32Array(numKeys);
            const distances = hierarchyLevels.slice(0, numKeys);
            return {
                attended: result.output,
                weights,
                distances,
                metrics: {
                    computeTimeMs: result.executionTimeMs ?? (Date.now() - startTime),
                    memoryUsedMB: (result.output.byteLength + weights.byteLength) / (1024 * 1024),
                },
            };
        }
        catch {
            // Fallback: simple hierarchical attention
            return this.fallbackHyperbolicAttention(queries, keys, values, hierarchyLevels, startTime);
        }
    }
    async flashAttention(queries, keys, values) {
        const startTime = Date.now();
        try {
            const result = await this.delegate.flashAttention(queries, keys, values);
            return {
                output: result.output,
                metrics: {
                    computeTimeMs: result.executionTimeMs ?? (Date.now() - startTime),
                    peakMemoryMB: result.output.byteLength / (1024 * 1024),
                    blocksProcessed: 1,
                },
            };
        }
        catch {
            // Fallback: chunked attention
            return this.fallbackFlashAttention(queries, keys, values, startTime);
        }
    }
    async graphRoPE(queries, keys, hopDistances) {
        const startTime = Date.now();
        // GraphRoPE is not in the controllers version; use fallback
        return this.fallbackGraphRoPE(queries, keys, hopDistances, startTime);
    }
    // ========================================================================
    // Fallback implementations (preserved from deprecated services version)
    // ========================================================================
    fallbackHyperbolicAttention(queries, keys, values, hierarchyLevels, startTime) {
        const dim = this.hyperbolicConfig.dimension;
        const numQueries = queries.length / dim;
        const numKeys = keys.length / dim;
        const scores = new Float32Array(numQueries * numKeys);
        const distances = [];
        for (let i = 0; i < numQueries; i++) {
            for (let j = 0; j < numKeys; j++) {
                let score = 0;
                for (let d = 0; d < dim; d++) {
                    score += queries[i * dim + d] * keys[j * dim + d];
                }
                const hierarchyScale = Math.exp(-hierarchyLevels[j] * 0.5);
                score *= hierarchyScale;
                scores[i * numKeys + j] = score;
                distances.push(hierarchyLevels[j]);
            }
        }
        const weights = this.softmax(scores, numQueries, numKeys);
        const attended = new Float32Array(numQueries * dim);
        for (let i = 0; i < numQueries; i++) {
            for (let j = 0; j < numKeys; j++) {
                const weight = weights[i * numKeys + j];
                for (let d = 0; d < dim; d++) {
                    attended[i * dim + d] += weight * values[j * dim + d];
                }
            }
        }
        return {
            attended,
            weights,
            distances,
            metrics: {
                computeTimeMs: Date.now() - startTime,
                memoryUsedMB: (attended.byteLength + weights.byteLength) / (1024 * 1024),
            },
        };
    }
    fallbackFlashAttention(queries, keys, values, startTime) {
        const dim = 384;
        const numQueries = queries.length / dim;
        const numKeys = keys.length / dim;
        const blockSize = this.flashConfig.blockSize;
        const output = new Float32Array(numQueries * dim);
        let blocksProcessed = 0;
        let peakMemory = 0;
        for (let qStart = 0; qStart < numQueries; qStart += blockSize) {
            const qEnd = Math.min(qStart + blockSize, numQueries);
            for (let kStart = 0; kStart < numKeys; kStart += blockSize) {
                const kEnd = Math.min(kStart + blockSize, numKeys);
                const blockScores = new Float32Array((qEnd - qStart) * (kEnd - kStart));
                for (let i = qStart; i < qEnd; i++) {
                    for (let j = kStart; j < kEnd; j++) {
                        let score = 0;
                        for (let d = 0; d < dim; d++) {
                            score += queries[i * dim + d] * keys[j * dim + d];
                        }
                        blockScores[(i - qStart) * (kEnd - kStart) + (j - kStart)] = score;
                    }
                }
                const blockWeights = this.softmax(blockScores, qEnd - qStart, kEnd - kStart);
                for (let i = qStart; i < qEnd; i++) {
                    for (let j = kStart; j < kEnd; j++) {
                        const weight = blockWeights[(i - qStart) * (kEnd - kStart) + (j - kStart)];
                        for (let d = 0; d < dim; d++) {
                            output[i * dim + d] += weight * values[j * dim + d];
                        }
                    }
                }
                peakMemory = Math.max(peakMemory, blockScores.byteLength + blockWeights.byteLength);
                blocksProcessed++;
            }
        }
        return {
            output,
            metrics: {
                computeTimeMs: Date.now() - startTime,
                peakMemoryMB: peakMemory / (1024 * 1024),
                blocksProcessed,
            },
        };
    }
    fallbackGraphRoPE(queries, keys, hopDistances, startTime) {
        const dim = 384;
        const numQueries = queries.length / dim;
        const numKeys = keys.length / dim;
        const encodedQueries = new Float32Array(queries);
        const encodedKeys = new Float32Array(keys);
        const hopEncodings = new Float32Array(numQueries * numKeys);
        for (let i = 0; i < numQueries; i++) {
            for (let j = 0; j < numKeys; j++) {
                const distance = hopDistances[i]?.[j] || 0;
                const scale = 1.0 / (1.0 + distance);
                hopEncodings[i * numKeys + j] = scale;
                for (let d = 0; d < dim; d++) {
                    encodedQueries[i * dim + d] *= Math.sqrt(scale);
                    encodedKeys[j * dim + d] *= Math.sqrt(scale);
                }
            }
        }
        return {
            queries: encodedQueries,
            keys: encodedKeys,
            hopEncodings,
            metrics: {
                computeTimeMs: Date.now() - startTime,
            },
        };
    }
    softmax(scores, rows, cols) {
        const result = new Float32Array(scores.length);
        for (let i = 0; i < rows; i++) {
            let max = -Infinity;
            for (let j = 0; j < cols; j++) {
                max = Math.max(max, scores[i * cols + j]);
            }
            let sum = 0;
            for (let j = 0; j < cols; j++) {
                result[i * cols + j] = Math.exp(scores[i * cols + j] - max);
                sum += result[i * cols + j];
            }
            for (let j = 0; j < cols; j++) {
                result[i * cols + j] /= sum;
            }
        }
        return result;
    }
    getConfig() {
        return {
            hyperbolic: this.hyperbolicConfig,
            flash: this.flashConfig,
            graphRoPE: this.graphRoPEConfig,
        };
    }
}
//# sourceMappingURL=LegacyAttentionAdapter.js.map