/**
 * HierarchicalMemory - 3-Tier Human-like Memory System
 *
 * Implements a biologically-inspired memory hierarchy with:
 * - Working Memory: Active context (fast access, 1MB limit)
 * - Episodic Memory: Recent experiences (hours-days)
 * - Semantic Memory: Long-term knowledge (consolidated)
 *
 * Based on:
 * - Atkinson-Shiffrin Multi-Store Model (1968)
 * - Tulving's Episodic/Semantic Distinction (1972)
 * - Baddeley's Working Memory Model (2000)
 *
 * Features:
 * - Automatic tier promotion based on access frequency and importance
 * - Forgetting curves (Ebbinghaus decay: R = e^(-t/S))
 * - Spaced repetition for consolidation
 * - Context-dependent recall
 * - Memory replay for reinforcement
 *
 * ADR-066 Phase P2-3
 */
import type { VectorBackend } from '../backends/VectorBackend.js';
import type { GraphBackend } from '../backends/GraphBackend.js';
import { EmbeddingService } from './EmbeddingService.js';
type Database = any;
/** Memory tier in the hierarchy */
export type MemoryTier = 'working' | 'episodic' | 'semantic';
/** Memory importance score (0-1, higher = more important) */
export type ImportanceScore = number;
/** Memory item with metadata and embeddings */
export interface MemoryItem {
    id: string;
    tier: MemoryTier;
    content: string;
    embedding?: Float32Array;
    importance: ImportanceScore;
    accessCount: number;
    createdAt: number;
    lastAccessedAt: number;
    lastRehearsedAt?: number;
    consolidatedAt?: number;
    tags?: string[];
    context?: Record<string, any>;
    metadata?: Record<string, any>;
}
/** Query for memory retrieval */
export interface MemoryQuery {
    query: string;
    queryEmbedding?: Float32Array;
    tier?: MemoryTier | MemoryTier[];
    k?: number;
    threshold?: number;
    context?: Record<string, any>;
    includeDecayed?: boolean;
}
/** Memory statistics */
export interface MemoryStats {
    working: {
        count: number;
        sizeBytes: number;
        avgImportance: number;
        avgAccessCount: number;
    };
    episodic: {
        count: number;
        sizeBytes: number;
        avgImportance: number;
        avgAge: number;
    };
    semantic: {
        count: number;
        sizeBytes: number;
        avgImportance: number;
        consolidationRate: number;
    };
    totalMemories: number;
    forgottenCount: number;
    promotionRate: number;
}
/** Forgetting curve configuration */
export interface ForgettingConfig {
    /** Base decay rate (higher = faster forgetting) */
    decayRate: number;
    /** Minimum retention (memories don't decay below this) */
    minRetention: number;
    /** Importance multiplier (important memories decay slower) */
    importanceMultiplier: number;
    /** Rehearsal boost (how much rehearsal extends retention) */
    rehearsalBoost: number;
}
/** Consolidation configuration */
export interface ConsolidationConfig {
    /** Minimum access count for consolidation */
    minAccessCount: number;
    /** Minimum importance for consolidation */
    minImportance: number;
    /** Minimum age (ms) before episodic → semantic */
    minAge: number;
    /** Maximum episodic memories before forced consolidation */
    maxEpisodicSize: number;
}
export interface HierarchicalMemoryConfig {
    /** Working memory size limit (bytes) */
    workingMemoryLimit: number;
    /** Episodic memory time window (ms) */
    episodicWindow: number;
    /** Forgetting curve parameters */
    forgetting: ForgettingConfig;
    /** Consolidation parameters */
    consolidation: ConsolidationConfig;
    /** Enable automatic consolidation */
    autoConsolidate: boolean;
}
export declare class HierarchicalMemory {
    private db;
    private embedder;
    private vectorBackend?;
    private graphBackend?;
    private config;
    private workingMemoryCache;
    private episodicMemoryIndex;
    private stats;
    constructor(db: Database, embedder: EmbeddingService, vectorBackend?: VectorBackend, graphBackend?: GraphBackend, config?: Partial<HierarchicalMemoryConfig>);
    /**
     * Initialize database tables for hierarchical memory
     */
    private initializeDatabase;
    /**
     * Store a new memory item
     */
    store(content: string, importance?: ImportanceScore, tier?: MemoryTier, options?: {
        tags?: string[];
        context?: Record<string, any>;
        metadata?: Record<string, any>;
    }): Promise<string>;
    /**
     * Retrieve memories matching the query
     */
    recall(query: MemoryQuery): Promise<MemoryItem[]>;
    /**
     * Promote memory to higher tier based on importance and access
     */
    promote(memoryId: string): Promise<boolean>;
    /**
     * Rehearse a memory to strengthen retention
     */
    rehearse(memoryId: string): Promise<void>;
    /**
     * Calculate retention score using Ebbinghaus forgetting curve
     * R(t) = e^(-t/S)
     * Where S = base_strength * importance_multiplier * rehearsal_boost
     */
    private calculateRetention;
    /**
     * Get memory statistics
     */
    getStats(): Promise<MemoryStats>;
    /**
     * Enforce working memory size limit by evicting least important items
     */
    private enforceWorkingMemoryLimit;
    /**
     * Calculate current working memory size in bytes
     */
    private calculateWorkingMemorySize;
    /**
     * Update memory tier
     */
    private updateTier;
    /**
     * Forget (delete) a memory
     */
    private forget;
    /**
     * Get memory item by ID
     */
    private getMemoryById;
    /**
     * Manual search without vector backend
     */
    private manualSearch;
    /**
     * Apply context filter to results
     */
    private applyContextFilter;
    /**
     * Update access tracking for retrieved memories
     */
    private updateAccessTracking;
    /**
     * Check if consolidation is needed and trigger if necessary
     */
    private checkConsolidation;
}
export {};
//# sourceMappingURL=HierarchicalMemory.d.ts.map