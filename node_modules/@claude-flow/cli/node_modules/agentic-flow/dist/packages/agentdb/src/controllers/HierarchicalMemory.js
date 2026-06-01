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
import { cosineSimilarity } from '../utils/vector-math.js';
export class HierarchicalMemory {
    db;
    embedder;
    vectorBackend;
    graphBackend;
    config;
    // In-memory caches for fast access
    workingMemoryCache = new Map();
    episodicMemoryIndex = new Map();
    // Stats tracking
    stats = {
        totalAccesses: 0,
        promotions: 0,
        consolidations: 0,
        forgotten: 0,
    };
    constructor(db, embedder, vectorBackend, graphBackend, config) {
        this.db = db;
        this.embedder = embedder;
        this.vectorBackend = vectorBackend;
        this.graphBackend = graphBackend;
        this.config = {
            workingMemoryLimit: 1024 * 1024, // 1MB
            episodicWindow: 7 * 24 * 60 * 60 * 1000, // 7 days
            forgetting: {
                decayRate: 0.3,
                minRetention: 0.1,
                importanceMultiplier: 2.0,
                rehearsalBoost: 1.5,
            },
            consolidation: {
                minAccessCount: 3,
                minImportance: 0.6,
                minAge: 24 * 60 * 60 * 1000, // 24 hours
                maxEpisodicSize: 1000,
            },
            autoConsolidate: true,
            ...config,
        };
        this.initializeDatabase();
    }
    /**
     * Initialize database tables for hierarchical memory
     */
    initializeDatabase() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS hierarchical_memory (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        last_rehearsed_at INTEGER,
        consolidated_at INTEGER,
        tags TEXT,
        context TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchical_tier ON hierarchical_memory(tier);
      CREATE INDEX IF NOT EXISTS idx_hierarchical_importance ON hierarchical_memory(importance);
      CREATE INDEX IF NOT EXISTS idx_hierarchical_access ON hierarchical_memory(access_count);
      CREATE INDEX IF NOT EXISTS idx_hierarchical_created ON hierarchical_memory(created_at);
    `);
    }
    /**
     * Store a new memory item
     */
    async store(content, importance = 0.5, tier = 'working', options) {
        const id = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        // Generate embedding
        const embedding = await this.embedder.embed(content);
        const item = {
            id,
            tier,
            content,
            embedding,
            importance,
            accessCount: 0,
            createdAt: now,
            lastAccessedAt: now,
            tags: options?.tags,
            context: options?.context,
            metadata: options?.metadata,
        };
        // Store in database
        const stmt = this.db.prepare(`
      INSERT INTO hierarchical_memory (
        id, tier, content, importance, access_count,
        created_at, last_accessed_at, tags, context, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, tier, content, importance, 0, now, now, options?.tags ? JSON.stringify(options.tags) : null, options?.context ? JSON.stringify(options.context) : null, options?.metadata ? JSON.stringify(options.metadata) : null);
        // Add to vector backend if available
        if (this.vectorBackend) {
            this.vectorBackend.insert(id, embedding, {
                tier,
                importance,
                createdAt: now,
                ...options?.metadata,
            });
        }
        // Cache in appropriate tier
        if (tier === 'working') {
            this.workingMemoryCache.set(id, item);
            await this.enforceWorkingMemoryLimit();
        }
        else if (tier === 'episodic') {
            this.episodicMemoryIndex.set(id, item);
        }
        // Trigger auto-consolidation if needed
        if (this.config.autoConsolidate) {
            await this.checkConsolidation();
        }
        return id;
    }
    /**
     * Retrieve memories matching the query
     */
    async recall(query) {
        this.stats.totalAccesses++;
        // Generate embedding if not provided
        const queryEmbedding = query.queryEmbedding || await this.embedder.embed(query.query);
        // Determine which tiers to search
        const tiers = Array.isArray(query.tier)
            ? query.tier
            : query.tier
                ? [query.tier]
                : ['working', 'episodic', 'semantic'];
        const k = query.k || 10;
        const threshold = query.threshold || 0.5;
        let results = [];
        // Search vector backend if available (faster)
        if (this.vectorBackend) {
            const searchResults = [];
            for (const tier of tiers) {
                const tierResults = await this.vectorBackend.search(queryEmbedding, k, {
                    threshold,
                    filter: { tier },
                });
                searchResults.push(...tierResults);
            }
            // Convert to MemoryItems
            results = await Promise.all(searchResults.map(async (result) => {
                const item = await this.getMemoryById(result.id);
                if (item) {
                    item.metadata = { ...item.metadata, similarity: result.similarity };
                }
                return item;
            })).then(items => items.filter((item) => item !== null));
        }
        else {
            // Fallback: manual search
            results = await this.manualSearch(queryEmbedding, ['working', 'episodic', 'semantic'], k, threshold);
        }
        // Apply forgetting curve if not including decayed
        if (!query.includeDecayed) {
            results = results.filter(item => this.calculateRetention(item) >= this.config.forgetting.minRetention);
        }
        // Context-dependent recall
        if (query.context) {
            results = this.applyContextFilter(results, query.context);
        }
        // Update access tracking and promote if needed
        await this.updateAccessTracking(results.map(r => r.id));
        return results.slice(0, k);
    }
    /**
     * Promote memory to higher tier based on importance and access
     */
    async promote(memoryId) {
        const item = await this.getMemoryById(memoryId);
        if (!item)
            return false;
        let newTier = null;
        // Working → Episodic: After multiple accesses
        if (item.tier === 'working' && item.accessCount >= 2) {
            newTier = 'episodic';
        }
        // Episodic → Semantic: Based on consolidation criteria
        if (item.tier === 'episodic') {
            const age = Date.now() - item.createdAt;
            if (item.accessCount >= this.config.consolidation.minAccessCount &&
                item.importance >= this.config.consolidation.minImportance &&
                age >= this.config.consolidation.minAge) {
                newTier = 'semantic';
            }
        }
        if (newTier) {
            await this.updateTier(memoryId, newTier);
            this.stats.promotions++;
            return true;
        }
        return false;
    }
    /**
     * Rehearse a memory to strengthen retention
     */
    async rehearse(memoryId) {
        const now = Date.now();
        const stmt = this.db.prepare(`
      UPDATE hierarchical_memory
      SET last_rehearsed_at = ?, access_count = access_count + 1
      WHERE id = ?
    `);
        stmt.run(now, memoryId);
        // Update cache
        const item = this.workingMemoryCache.get(memoryId) || this.episodicMemoryIndex.get(memoryId);
        if (item) {
            item.lastRehearsedAt = now;
            item.accessCount++;
        }
    }
    /**
     * Calculate retention score using Ebbinghaus forgetting curve
     * R(t) = e^(-t/S)
     * Where S = base_strength * importance_multiplier * rehearsal_boost
     */
    calculateRetention(item) {
        const now = Date.now();
        const timeSinceCreation = (now - item.createdAt) / (24 * 60 * 60 * 1000); // days
        const timeSinceRehearsal = item.lastRehearsedAt
            ? (now - item.lastRehearsedAt) / (24 * 60 * 60 * 1000)
            : timeSinceCreation;
        // Calculate strength (inverse of decay rate)
        const baseStrength = 1 / this.config.forgetting.decayRate;
        const importanceBoost = 1 + (item.importance * this.config.forgetting.importanceMultiplier);
        const rehearsalBoost = item.lastRehearsedAt ? this.config.forgetting.rehearsalBoost : 1.0;
        const strength = baseStrength * importanceBoost * rehearsalBoost;
        // Ebbinghaus formula
        const retention = Math.exp(-timeSinceRehearsal / strength);
        return Math.max(retention, this.config.forgetting.minRetention);
    }
    /**
     * Get memory statistics
     */
    async getStats() {
        const workingStats = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        AVG(importance) as avgImportance,
        AVG(access_count) as avgAccessCount,
        SUM(LENGTH(content)) as sizeBytes
      FROM hierarchical_memory WHERE tier = 'working'
    `).get();
        const episodicStats = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        AVG(importance) as avgImportance,
        AVG(? - created_at) as avgAge,
        SUM(LENGTH(content)) as sizeBytes
      FROM hierarchical_memory WHERE tier = 'episodic'
    `).get(Date.now());
        const semanticStats = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        AVG(importance) as avgImportance,
        COUNT(CASE WHEN consolidated_at IS NOT NULL THEN 1 END) as consolidated,
        SUM(LENGTH(content)) as sizeBytes
      FROM hierarchical_memory WHERE tier = 'semantic'
    `).get();
        const totalMemories = workingStats.count + episodicStats.count + semanticStats.count;
        const promotionRate = totalMemories > 0 ? this.stats.promotions / totalMemories : 0;
        return {
            working: {
                count: workingStats.count || 0,
                sizeBytes: workingStats.sizeBytes || 0,
                avgImportance: workingStats.avgImportance || 0,
                avgAccessCount: workingStats.avgAccessCount || 0,
            },
            episodic: {
                count: episodicStats.count || 0,
                sizeBytes: episodicStats.sizeBytes || 0,
                avgImportance: episodicStats.avgImportance || 0,
                avgAge: episodicStats.avgAge || 0,
            },
            semantic: {
                count: semanticStats.count || 0,
                sizeBytes: semanticStats.sizeBytes || 0,
                avgImportance: semanticStats.avgImportance || 0,
                consolidationRate: semanticStats.count > 0
                    ? (semanticStats.consolidated || 0) / semanticStats.count
                    : 0,
            },
            totalMemories,
            forgottenCount: this.stats.forgotten,
            promotionRate,
        };
    }
    /**
     * Enforce working memory size limit by evicting least important items
     */
    async enforceWorkingMemoryLimit() {
        const currentSize = this.calculateWorkingMemorySize();
        if (currentSize > this.config.workingMemoryLimit) {
            // Get working memories sorted by importance * retention
            const memories = Array.from(this.workingMemoryCache.values())
                .map(item => ({
                ...item,
                score: item.importance * this.calculateRetention(item),
            }))
                .sort((a, b) => a.score - b.score);
            // Evict until under limit
            let freedSize = 0;
            for (const memory of memories) {
                if (currentSize - freedSize <= this.config.workingMemoryLimit)
                    break;
                // Promote to episodic or forget
                if (memory.score > 0.3) {
                    await this.updateTier(memory.id, 'episodic');
                }
                else {
                    await this.forget(memory.id);
                }
                freedSize += new TextEncoder().encode(memory.content).length;
                this.workingMemoryCache.delete(memory.id);
            }
        }
    }
    /**
     * Calculate current working memory size in bytes
     */
    calculateWorkingMemorySize() {
        let size = 0;
        for (const item of this.workingMemoryCache.values()) {
            size += new TextEncoder().encode(item.content).length;
        }
        return size;
    }
    /**
     * Update memory tier
     */
    async updateTier(memoryId, newTier) {
        const now = Date.now();
        const stmt = this.db.prepare(`
      UPDATE hierarchical_memory
      SET tier = ?, consolidated_at = ?
      WHERE id = ?
    `);
        stmt.run(newTier, newTier === 'semantic' ? now : null, memoryId);
        // Update caches
        const item = this.workingMemoryCache.get(memoryId) || this.episodicMemoryIndex.get(memoryId);
        if (item) {
            item.tier = newTier;
            if (newTier === 'semantic') {
                item.consolidatedAt = now;
            }
            // Move between caches
            this.workingMemoryCache.delete(memoryId);
            this.episodicMemoryIndex.delete(memoryId);
            if (newTier === 'working') {
                this.workingMemoryCache.set(memoryId, item);
            }
            else if (newTier === 'episodic') {
                this.episodicMemoryIndex.set(memoryId, item);
            }
        }
        // Update vector backend metadata
        if (this.vectorBackend && item?.embedding) {
            this.vectorBackend.insert(memoryId, item.embedding, {
                tier: newTier,
                consolidated: newTier === 'semantic',
            });
        }
    }
    /**
     * Forget (delete) a memory
     */
    async forget(memoryId) {
        this.db.prepare('DELETE FROM hierarchical_memory WHERE id = ?').run(memoryId);
        this.workingMemoryCache.delete(memoryId);
        this.episodicMemoryIndex.delete(memoryId);
        this.stats.forgotten++;
        // Remove from vector backend
        if (this.vectorBackend) {
            this.vectorBackend.remove(memoryId);
        }
    }
    /**
     * Get memory item by ID
     */
    async getMemoryById(id) {
        // Check caches first
        const cached = this.workingMemoryCache.get(id) || this.episodicMemoryIndex.get(id);
        if (cached)
            return cached;
        // Fetch from database
        const row = this.db.prepare(`
      SELECT * FROM hierarchical_memory WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        const item = {
            id: row.id,
            tier: row.tier,
            content: row.content,
            importance: row.importance,
            accessCount: row.access_count,
            createdAt: row.created_at,
            lastAccessedAt: row.last_accessed_at,
            lastRehearsedAt: row.last_rehearsed_at,
            consolidatedAt: row.consolidated_at,
            tags: row.tags ? JSON.parse(row.tags) : undefined,
            context: row.context ? JSON.parse(row.context) : undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        };
        return item;
    }
    /**
     * Manual search without vector backend
     */
    async manualSearch(queryEmbedding, tiers, k, threshold) {
        const tierFilter = tiers.map(t => `'${t}'`).join(',');
        const rows = this.db.prepare(`
      SELECT * FROM hierarchical_memory
      WHERE tier IN (${tierFilter})
      ORDER BY importance DESC
      LIMIT ?
    `).all(k * 2); // Get more to account for filtering
        const results = [];
        for (const row of rows) {
            const embedding = await this.embedder.embed(row.content);
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            if (similarity >= threshold) {
                results.push({
                    id: row.id,
                    tier: row.tier,
                    content: row.content,
                    embedding,
                    importance: row.importance,
                    accessCount: row.access_count,
                    createdAt: row.created_at,
                    lastAccessedAt: row.last_accessed_at,
                    lastRehearsedAt: row.last_rehearsed_at,
                    consolidatedAt: row.consolidated_at,
                    tags: row.tags ? JSON.parse(row.tags) : undefined,
                    context: row.context ? JSON.parse(row.context) : undefined,
                    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
                    similarity,
                });
            }
        }
        return results.sort((a, b) => b.similarity - a.similarity).slice(0, k);
    }
    /**
     * Apply context filter to results
     */
    applyContextFilter(results, context) {
        return results.filter(item => {
            if (!item.context)
                return false;
            // Check if at least 50% of context keys match
            const keys = Object.keys(context);
            const matches = keys.filter(key => item.context[key] === context[key]).length;
            return matches / keys.length >= 0.5;
        });
    }
    /**
     * Update access tracking for retrieved memories
     */
    async updateAccessTracking(ids) {
        if (ids.length === 0)
            return;
        const now = Date.now();
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`
      UPDATE hierarchical_memory
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE id IN (${placeholders})
    `).run(now, ...ids);
        // Update caches
        for (const id of ids) {
            const item = this.workingMemoryCache.get(id) || this.episodicMemoryIndex.get(id);
            if (item) {
                item.accessCount++;
                item.lastAccessedAt = now;
                // Check for promotion
                await this.promote(id);
            }
        }
    }
    /**
     * Check if consolidation is needed and trigger if necessary
     */
    async checkConsolidation() {
        const episodicCount = this.episodicMemoryIndex.size;
        if (episodicCount >= this.config.consolidation.maxEpisodicSize) {
            // Trigger consolidation (will be handled by MemoryConsolidation service)
            console.log(`⚠️ Episodic memory full (${episodicCount} items). Consolidation recommended.`);
        }
    }
}
//# sourceMappingURL=HierarchicalMemory.js.map