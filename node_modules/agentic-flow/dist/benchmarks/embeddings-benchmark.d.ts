/**
 * Embeddings Performance Benchmark Suite
 *
 * Measures performance of:
 * - O(1) LRU Cache operations
 * - Parallel batch embedding
 * - 8x unrolled cosine similarity
 * - Neural substrate operations
 * - Overall throughput
 */
interface BenchmarkResult {
    name: string;
    iterations: number;
    totalMs: number;
    avgMs: number;
    opsPerSec: number;
    minMs: number;
    maxMs: number;
    p95Ms: number;
}
declare function benchmark(name: string, fn: () => Promise<void> | void, iterations?: number): Promise<BenchmarkResult>;
declare function runBenchmarks(): Promise<{
    results: BenchmarkResult[];
    memory: {
        heapBefore: number;
        heapAfter: number;
        heapDelta: number;
        gcPauses: number;
    };
    throughput: {
        textsProcessed: number;
        totalTimeMs: number;
        textsPerSecond: number;
    };
}>;
export { runBenchmarks, benchmark };
export type { BenchmarkResult };
//# sourceMappingURL=embeddings-benchmark.d.ts.map