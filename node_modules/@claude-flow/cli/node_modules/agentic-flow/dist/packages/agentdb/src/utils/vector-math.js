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
export function cosineSimilarity(a, b) {
    const len = Math.min(a.length, b.length);
    if (len === 0)
        return 0;
    let dot = 0, magA = 0, magB = 0;
    // 4x loop unrolling
    const unrolled = len - (len % 4);
    for (let i = 0; i < unrolled; i += 4) {
        dot += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
        magA += a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] + a[i + 3] * a[i + 3];
        magB += b[i] * b[i] + b[i + 1] * b[i + 1] + b[i + 2] * b[i + 2] + b[i + 3] * b[i + 3];
    }
    // Handle remainder
    for (let i = unrolled; i < len; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}
/**
 * Batch cosine similarity: compute similarity of query against multiple vectors.
 */
export function batchCosineSimilarity(query, corpus) {
    return corpus.map(vec => cosineSimilarity(query, vec));
}
/**
 * Convert distance metric to similarity score (0-1).
 */
export function distanceToSimilarity(distance, metric = 'cosine') {
    switch (metric) {
        case 'cosine': return 1 - distance;
        case 'l2': return 1 / (1 + distance);
        case 'ip': return distance; // inner product is already a similarity
        default: return 1 - distance;
    }
}
/**
 * Serialize embedding to Buffer for storage.
 */
export function serializeEmbedding(embedding) {
    return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}
/**
 * Deserialize embedding from Buffer.
 */
export function deserializeEmbedding(buffer) {
    const ab = new ArrayBuffer(buffer.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buffer.length; i++)
        view[i] = buffer[i];
    return new Float32Array(ab);
}
//# sourceMappingURL=vector-math.js.map