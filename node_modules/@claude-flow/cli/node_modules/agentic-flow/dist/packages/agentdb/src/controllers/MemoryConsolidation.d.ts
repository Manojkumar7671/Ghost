/**
 * MemoryConsolidation - Nightly Memory Processing
 *
 * Implements automatic memory consolidation from episodic to semantic memory
 * using spaced repetition and importance scoring.
 *
 * Based on:
 * - Complementary Learning Systems (McClelland et al., 1995)
 * - Active Systems Consolidation (Diekelmann & Born, 2010)
 * - Spaced Repetition (Ebbinghaus, 1885)
 *
 * Process:
 * 1. Identify consolidation candidates (high importance + multiple accesses)
 * 2. Cluster similar episodic memories
 * 3. Extract semantic patterns (abstractions)
 * 4. Promote to semantic memory
 * 5. Apply forgetting to low-value episodic memories
 * 6. Schedule spaced repetition for important memories
 *
 * ADR-066 Phase P2-3
 */
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { GraphBackend } from '../backends/GraphBackend.js';
import { HierarchicalMemory } from './HierarchicalMemory.js';
import { EmbeddingService } from './EmbeddingService.js';
type Database = any;
/** Consolidation result report */
export interface ConsolidationReport {
    timestamp: number;
    executionTimeMs: number;
    episodicProcessed: number;
    semanticCreated: number;
    memoriesForgotten: number;
    clustersFormed: number;
    avgImportance: number;
    retentionRate: number;
    recommendations: string[];
}
export interface ConsolidationConfig {
    /** Minimum similarity for clustering (0-1) */
    clusterThreshold: number;
    /** Minimum cluster size for semantic extraction */
    minClusterSize: number;
    /** Maximum cluster size before splitting */
    maxClusterSize: number;
    /** Importance threshold for consolidation */
    importanceThreshold: number;
    /** Minimum access count for consolidation */
    minAccessCount: number;
    /** Enable spaced repetition */
    enableSpacedRepetition: boolean;
    /** Initial repetition interval (ms) */
    initialInterval: number;
    /** Interval multiplier for successful recall */
    intervalMultiplier: number;
    /** Forgetting threshold (retention below this = forget) */
    forgettingThreshold: number;
}
export declare class MemoryConsolidation {
    private db;
    private hierarchicalMemory;
    private embedder;
    private vectorBackend?;
    private graphBackend?;
    private config;
    private repetitionSchedules;
    constructor(db: Database, hierarchicalMemory: HierarchicalMemory, embedder: EmbeddingService, vectorBackend?: VectorBackend, graphBackend?: GraphBackend, config?: Partial<ConsolidationConfig>);
    /**
     * Initialize database tables for consolidation tracking
     */
    private initializeDatabase;
    /**
     * Run nightly consolidation process
     */
    consolidate(): Promise<ConsolidationReport>;
    /**
     * Get episodic memories that are candidates for consolidation
     */
    private getConsolidationCandidates;
    /**
     * Cluster similar memories using hierarchical clustering
     */
    private clusterMemories;
    /**
     * Update cluster centroid (simple average)
     */
    private updateCentroid;
    /**
     * Create semantic memory from cluster
     */
    private createSemanticMemory;
    /**
     * Extract semantic pattern from cluster
     */
    private extractSemanticPattern;
    /**
     * Extract common tags from cluster members
     */
    private extractCommonTags;
    /**
     * Mark episodic memory as consolidated
     */
    private markConsolidated;
    /**
     * Apply forgetting curve and delete low-value memories
     */
    private applyForgettingCurve;
    /**
     * Calculate retention using Ebbinghaus forgetting curve
     */
    private calculateRetention;
    /**
     * Schedule spaced repetition for memories
     */
    private scheduleSpacedRepetition;
    /**
     * Update repetition schedule after review
     */
    private updateRepetitionSchedule;
    /**
     * Save repetition schedule to database
     */
    private saveRepetitionSchedule;
    /**
     * Load repetition schedules from database
     */
    private loadRepetitionSchedules;
    /**
     * Generate recommendations based on consolidation report
     */
    private generateRecommendations;
    /**
     * Log consolidation to database
     */
    private logConsolidation;
    /**
     * Get consolidation history
     */
    getConsolidationHistory(limit?: number): Promise<ConsolidationReport[]>;
}
export {};
//# sourceMappingURL=MemoryConsolidation.d.ts.map