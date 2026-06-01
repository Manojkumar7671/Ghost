/**
 * Shared Vector Math Utilities
 *
 * Eliminates 8+ duplicate cosineSimilarity implementations across controllers.
 * Uses 4x loop unrolling from WASMVectorSearch for best JS performance.
 * Future: WASM SIMD acceleration via P2.2.
 */
/**
 * Cosine similarity with 4x loop unrolling for optimal JS performance.
 * Handles both number[] and Float32Array inputs.
 */
export declare function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number;
/**
 * Batch cosine similarity: compute similarity of query against multiple vectors.
 */
export declare function batchCosineSimilarity(query: ArrayLike<number>, corpus: ArrayLike<number>[]): number[];
/**
 * Convert distance metric to similarity score (0-1).
 */
export declare function distanceToSimilarity(distance: number, metric?: 'cosine' | 'l2' | 'ip'): number;
/**
 * Serialize embedding to Buffer for storage.
 */
export declare function serializeEmbedding(embedding: Float32Array): Buffer;
/**
 * Deserialize embedding from Buffer.
 */
export declare function deserializeEmbedding(buffer: Buffer): Float32Array;
//# sourceMappingURL=vector-math.d.ts.map