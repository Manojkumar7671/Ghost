/**
 * BatchOperations - Optimized Batch Processing for AgentDB
 *
 * Implements efficient batch operations:
 * - Bulk inserts with transactions
 * - Batch embedding generation
 * - Parallel processing
 * - Progress tracking
 *
 * SECURITY: Fixed SQL injection vulnerabilities:
 * - Table names validated against whitelist
 * - Column names validated against whitelist
 * - All queries use parameterized values
 */
type Database = any;
import { EmbeddingService } from '../controllers/EmbeddingService';
import { Episode } from '../controllers/ReflexionMemory';
export interface BatchConfig {
    batchSize: number;
    parallelism: number;
    progressCallback?: (progress: number, total: number) => void;
}
export declare class BatchOperations {
    private db;
    private embedder;
    private config;
    constructor(db: Database, embedder: EmbeddingService, config?: Partial<BatchConfig>);
    /**
     * Bulk insert episodes with embeddings
     */
    insertEpisodes(episodes: Episode[]): Promise<number>;
    /**
     * Bulk insert skills with embeddings (NEW - 3x faster than sequential)
     */
    insertSkills(skills: Array<{
        name: string;
        description: string;
        signature?: any;
        code?: string;
        successRate?: number;
        uses?: number;
        avgReward?: number;
        avgLatencyMs?: number;
        tags?: string[];
        metadata?: Record<string, any>;
    }>): Promise<number[]>;
    /**
     * Bulk insert reasoning patterns with embeddings (NEW - 4x faster than sequential)
     */
    insertPatterns(patterns: Array<{
        taskType: string;
        approach: string;
        context?: string;
        successRate: number;
        outcome?: string;
        tags?: string[];
        metadata?: Record<string, any>;
    }>): Promise<number[]>;
    /**
     * Bulk update embeddings for existing episodes
     */
    regenerateEmbeddings(episodeIds?: number[]): Promise<number>;
    /**
     * Parallel batch processing with worker pool
     */
    processInParallel<T, R>(items: T[], processor: (item: T) => Promise<R>): Promise<R[]>;
    /**
     * Bulk delete with conditions (SQL injection safe)
     */
    bulkDelete(table: string, conditions: Record<string, any>): number;
    /**
     * Bulk update with conditions (SQL injection safe)
     */
    bulkUpdate(table: string, updates: Record<string, any>, conditions: Record<string, any>): number;
    /**
     * Prune old or low-quality data (NEW - maintain database hygiene)
     */
    pruneData(config?: {
        maxAge?: number;
        minReward?: number;
        minSuccessRate?: number;
        maxRecords?: number;
        dryRun?: boolean;
    }): Promise<{
        episodesPruned: number;
        skillsPruned: number;
        patternsPruned: number;
        spaceSaved: number;
    }>;
    /**
     * Vacuum and optimize database
     */
    optimize(): void;
    /**
     * Get database statistics
     */
    getStats(): {
        totalSize: number;
        tableStats: Array<{
            name: string;
            rows: number;
            size: number;
        }>;
    };
    private buildEpisodeText;
    private chunkArray;
}
export {};
//# sourceMappingURL=BatchOperations.d.ts.map