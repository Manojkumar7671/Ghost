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
import { cosineSimilarity } from '../utils/vector-math.js';
export class MemoryConsolidation {
    db;
    hierarchicalMemory;
    embedder;
    vectorBackend;
    graphBackend;
    config;
    // Spaced repetition tracking
    repetitionSchedules = new Map();
    constructor(db, hierarchicalMemory, embedder, vectorBackend, graphBackend, config) {
        this.db = db;
        this.hierarchicalMemory = hierarchicalMemory;
        this.embedder = embedder;
        this.vectorBackend = vectorBackend;
        this.graphBackend = graphBackend;
        this.config = {
            clusterThreshold: 0.75,
            minClusterSize: 3,
            maxClusterSize: 20,
            importanceThreshold: 0.6,
            minAccessCount: 3,
            enableSpacedRepetition: true,
            initialInterval: 24 * 60 * 60 * 1000, // 24 hours
            intervalMultiplier: 2.0,
            forgettingThreshold: 0.2,
            ...config,
        };
        this.initializeDatabase();
        this.loadRepetitionSchedules();
    }
    /**
     * Initialize database tables for consolidation tracking
     */
    initializeDatabase() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS consolidation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        execution_time_ms INTEGER NOT NULL,
        episodic_processed INTEGER NOT NULL,
        semantic_created INTEGER NOT NULL,
        memories_forgotten INTEGER NOT NULL,
        clusters_formed INTEGER NOT NULL,
        retention_rate REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spaced_repetition (
        memory_id TEXT PRIMARY KEY,
        next_review INTEGER NOT NULL,
        interval INTEGER NOT NULL,
        ease_factor REAL NOT NULL,
        repetitions INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spaced_next_review ON spaced_repetition(next_review);
    `);
    }
    /**
     * Run nightly consolidation process
     */
    async consolidate() {
        console.log('\n🌙 Starting Memory Consolidation...\n');
        const startTime = Date.now();
        const report = {
            timestamp: startTime,
            executionTimeMs: 0,
            episodicProcessed: 0,
            semanticCreated: 0,
            memoriesForgotten: 0,
            clustersFormed: 0,
            avgImportance: 0,
            retentionRate: 0,
            recommendations: [],
        };
        try {
            // Step 1: Get consolidation candidates
            console.log('📊 Identifying consolidation candidates...');
            const candidates = await this.getConsolidationCandidates();
            report.episodicProcessed = candidates.length;
            console.log(`   Found ${candidates.length} episodic memories`);
            if (candidates.length === 0) {
                console.log('✅ No memories to consolidate');
                report.executionTimeMs = Date.now() - startTime;
                return report;
            }
            // Step 2: Cluster similar memories
            console.log('🔗 Clustering similar memories...');
            const clusters = await this.clusterMemories(candidates);
            report.clustersFormed = clusters.length;
            console.log(`   Formed ${clusters.length} clusters`);
            // Step 3: Extract semantic patterns and create semantic memories
            console.log('🧠 Extracting semantic patterns...');
            for (const cluster of clusters) {
                if (cluster.members.length >= this.config.minClusterSize) {
                    const semanticMemory = await this.createSemanticMemory(cluster);
                    if (semanticMemory) {
                        report.semanticCreated++;
                    }
                }
            }
            console.log(`   Created ${report.semanticCreated} semantic memories`);
            // Step 4: Apply forgetting curve
            console.log('🗑️  Applying forgetting curve...');
            const forgotten = await this.applyForgettingCurve(candidates);
            report.memoriesForgotten = forgotten;
            console.log(`   Forgot ${forgotten} low-value memories`);
            // Step 5: Schedule spaced repetition
            if (this.config.enableSpacedRepetition) {
                console.log('📅 Scheduling spaced repetition...');
                await this.scheduleSpacedRepetition(candidates);
                console.log(`   Scheduled ${candidates.length - forgotten} memories`);
            }
            // Step 6: Calculate statistics
            const totalImportance = candidates.reduce((sum, m) => sum + m.importance, 0);
            report.avgImportance = candidates.length > 0 ? totalImportance / candidates.length : 0;
            report.retentionRate = candidates.length > 0
                ? (candidates.length - forgotten) / candidates.length
                : 0;
            // Step 7: Generate recommendations
            report.recommendations = this.generateRecommendations(report);
            report.executionTimeMs = Date.now() - startTime;
            // Log consolidation
            this.logConsolidation(report);
            console.log('\n✅ Memory Consolidation Complete');
            console.log(`   Time: ${report.executionTimeMs}ms`);
            console.log(`   Retention: ${(report.retentionRate * 100).toFixed(1)}%`);
            return report;
        }
        catch (error) {
            console.error('❌ Memory consolidation failed:', error);
            report.executionTimeMs = Date.now() - startTime;
            return report;
        }
    }
    /**
     * Get episodic memories that are candidates for consolidation
     */
    async getConsolidationCandidates() {
        const rows = this.db.prepare(`
      SELECT * FROM hierarchical_memory
      WHERE tier = 'episodic'
        AND importance >= ?
        AND access_count >= ?
      ORDER BY importance DESC, access_count DESC
    `).all(this.config.importanceThreshold, this.config.minAccessCount);
        const candidates = [];
        for (const row of rows) {
            const embedding = await this.embedder.embed(row.content);
            candidates.push({
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
            });
        }
        return candidates;
    }
    /**
     * Cluster similar memories using hierarchical clustering
     */
    async clusterMemories(memories) {
        if (memories.length === 0)
            return [];
        const clusters = [];
        const assigned = new Set();
        // Simple greedy clustering
        for (const memory of memories) {
            if (assigned.has(memory.id))
                continue;
            // Create new cluster
            const cluster = {
                id: `cluster-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                centroid: memory.embedding,
                members: [memory],
                avgImportance: memory.importance,
            };
            assigned.add(memory.id);
            // Find similar memories to add to cluster
            for (const candidate of memories) {
                if (assigned.has(candidate.id))
                    continue;
                if (cluster.members.length >= this.config.maxClusterSize)
                    break;
                const similarity = cosineSimilarity(cluster.centroid, candidate.embedding);
                if (similarity >= this.config.clusterThreshold) {
                    cluster.members.push(candidate);
                    assigned.add(candidate.id);
                    // Update centroid (simple average)
                    this.updateCentroid(cluster);
                }
            }
            // Calculate average importance
            cluster.avgImportance = cluster.members.reduce((sum, m) => sum + m.importance, 0) / cluster.members.length;
            clusters.push(cluster);
        }
        return clusters;
    }
    /**
     * Update cluster centroid (simple average)
     */
    updateCentroid(cluster) {
        const dimension = cluster.centroid.length;
        const newCentroid = new Float32Array(dimension);
        for (const member of cluster.members) {
            for (let i = 0; i < dimension; i++) {
                newCentroid[i] += member.embedding[i];
            }
        }
        for (let i = 0; i < dimension; i++) {
            newCentroid[i] /= cluster.members.length;
        }
        cluster.centroid = newCentroid;
    }
    /**
     * Create semantic memory from cluster
     */
    async createSemanticMemory(cluster) {
        // Extract common pattern from cluster members
        const pattern = this.extractSemanticPattern(cluster);
        if (!pattern)
            return null;
        // Calculate consolidated importance (weighted by access count)
        const totalAccess = cluster.members.reduce((sum, m) => sum + m.accessCount, 0);
        const weightedImportance = cluster.members.reduce((sum, m) => sum + (m.importance * m.accessCount), 0) / totalAccess;
        // Store as semantic memory
        const memoryId = await this.hierarchicalMemory.store(pattern, weightedImportance, 'semantic', {
            tags: this.extractCommonTags(cluster),
            metadata: {
                clusterId: cluster.id,
                clusterSize: cluster.members.length,
                sourceMemories: cluster.members.map(m => m.id),
                consolidatedAt: Date.now(),
            },
        });
        // Mark source episodic memories as consolidated
        for (const member of cluster.members) {
            await this.markConsolidated(member.id);
        }
        return memoryId;
    }
    /**
     * Extract semantic pattern from cluster
     */
    extractSemanticPattern(cluster) {
        if (cluster.members.length < this.config.minClusterSize)
            return null;
        // Simple pattern: find common themes in content
        // In production, this could use LLM for better abstraction
        const contents = cluster.members.map(m => m.content);
        // For now, just return a summary of the most important memory
        const mostImportant = cluster.members.reduce((best, m) => m.importance > best.importance ? m : best);
        const pattern = `Pattern: ${mostImportant.content} (consolidated from ${cluster.members.length} similar memories)`;
        return pattern;
    }
    /**
     * Extract common tags from cluster members
     */
    extractCommonTags(cluster) {
        const tagCounts = new Map();
        for (const member of cluster.members) {
            if (member.tags) {
                for (const tag of member.tags) {
                    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                }
            }
        }
        // Return tags that appear in at least 50% of members
        const threshold = cluster.members.length * 0.5;
        return Array.from(tagCounts.entries())
            .filter(([_, count]) => count >= threshold)
            .map(([tag, _]) => tag);
    }
    /**
     * Mark episodic memory as consolidated
     */
    async markConsolidated(memoryId) {
        const now = Date.now();
        this.db.prepare(`
      UPDATE hierarchical_memory
      SET consolidated_at = ?
      WHERE id = ?
    `).run(now, memoryId);
    }
    /**
     * Apply forgetting curve and delete low-value memories
     */
    async applyForgettingCurve(memories) {
        let forgotten = 0;
        for (const memory of memories) {
            const retention = this.calculateRetention(memory);
            if (retention < this.config.forgettingThreshold) {
                // Delete from database
                this.db.prepare('DELETE FROM hierarchical_memory WHERE id = ?').run(memory.id);
                // Remove from vector backend
                if (this.vectorBackend) {
                    this.vectorBackend.remove(memory.id);
                }
                forgotten++;
            }
        }
        return forgotten;
    }
    /**
     * Calculate retention using Ebbinghaus forgetting curve
     */
    calculateRetention(memory) {
        const now = Date.now();
        const daysSinceCreation = (now - memory.createdAt) / (24 * 60 * 60 * 1000);
        const daysSinceRehearsal = memory.lastRehearsedAt
            ? (now - memory.lastRehearsedAt) / (24 * 60 * 60 * 1000)
            : daysSinceCreation;
        // Strength increases with importance and rehearsal
        const baseStrength = 5; // days
        const importanceMultiplier = 1 + memory.importance * 2;
        const rehearsalBoost = memory.lastRehearsedAt ? 1.5 : 1.0;
        const strength = baseStrength * importanceMultiplier * rehearsalBoost;
        // Ebbinghaus: R = e^(-t/S)
        return Math.exp(-daysSinceRehearsal / strength);
    }
    /**
     * Schedule spaced repetition for memories
     */
    async scheduleSpacedRepetition(memories) {
        const now = Date.now();
        for (const memory of memories) {
            const existingSchedule = this.repetitionSchedules.get(memory.id);
            if (existingSchedule) {
                // Update existing schedule if review is due
                if (now >= existingSchedule.nextReview) {
                    this.updateRepetitionSchedule(memory.id, true);
                }
            }
            else {
                // Create new schedule
                const schedule = {
                    memoryId: memory.id,
                    nextReview: now + this.config.initialInterval,
                    interval: this.config.initialInterval,
                    easeFactor: 2.5, // SM-2 algorithm default
                    repetitions: 0,
                };
                this.repetitionSchedules.set(memory.id, schedule);
                this.saveRepetitionSchedule(schedule);
            }
        }
    }
    /**
     * Update repetition schedule after review
     */
    updateRepetitionSchedule(memoryId, success) {
        const schedule = this.repetitionSchedules.get(memoryId);
        if (!schedule)
            return;
        if (success) {
            // Increase interval (spaced repetition)
            schedule.repetitions++;
            schedule.interval = Math.floor(schedule.interval * this.config.intervalMultiplier);
            schedule.nextReview = Date.now() + schedule.interval;
        }
        else {
            // Reset interval on failure
            schedule.repetitions = 0;
            schedule.interval = this.config.initialInterval;
            schedule.nextReview = Date.now() + schedule.interval;
        }
        this.saveRepetitionSchedule(schedule);
    }
    /**
     * Save repetition schedule to database
     */
    saveRepetitionSchedule(schedule) {
        this.db.prepare(`
      INSERT OR REPLACE INTO spaced_repetition
      (memory_id, next_review, interval, ease_factor, repetitions)
      VALUES (?, ?, ?, ?, ?)
    `).run(schedule.memoryId, schedule.nextReview, schedule.interval, schedule.easeFactor, schedule.repetitions);
    }
    /**
     * Load repetition schedules from database
     */
    loadRepetitionSchedules() {
        const rows = this.db.prepare('SELECT * FROM spaced_repetition').all();
        for (const row of rows) {
            this.repetitionSchedules.set(row.memory_id, {
                memoryId: row.memory_id,
                nextReview: row.next_review,
                interval: row.interval,
                easeFactor: row.ease_factor,
                repetitions: row.repetitions,
            });
        }
    }
    /**
     * Generate recommendations based on consolidation report
     */
    generateRecommendations(report) {
        const recommendations = [];
        if (report.retentionRate < 0.5) {
            recommendations.push('Low retention rate. Consider increasing importance thresholds.');
        }
        if (report.clustersFormed === 0 && report.episodicProcessed > 10) {
            recommendations.push('No clusters formed. Consider lowering similarity threshold.');
        }
        if (report.semanticCreated < report.clustersFormed * 0.5) {
            recommendations.push('Low semantic memory creation. Check cluster size thresholds.');
        }
        if (report.avgImportance < 0.5) {
            recommendations.push('Average importance is low. Consider adjusting importance scoring.');
        }
        if (report.memoriesForgotten > report.episodicProcessed * 0.8) {
            recommendations.push('High forgetting rate. Consider lowering forgetting threshold.');
        }
        return recommendations;
    }
    /**
     * Log consolidation to database
     */
    logConsolidation(report) {
        this.db.prepare(`
      INSERT INTO consolidation_log (
        timestamp, execution_time_ms, episodic_processed, semantic_created,
        memories_forgotten, clusters_formed, retention_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(report.timestamp, report.executionTimeMs, report.episodicProcessed, report.semanticCreated, report.memoriesForgotten, report.clustersFormed, report.retentionRate);
    }
    /**
     * Get consolidation history
     */
    async getConsolidationHistory(limit = 10) {
        const rows = this.db.prepare(`
      SELECT * FROM consolidation_log
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);
        return rows.map(row => ({
            timestamp: row.timestamp,
            executionTimeMs: row.execution_time_ms,
            episodicProcessed: row.episodic_processed,
            semanticCreated: row.semantic_created,
            memoriesForgotten: row.memories_forgotten,
            clustersFormed: row.clusters_formed,
            avgImportance: 0,
            retentionRate: row.retention_rate,
            recommendations: [],
        }));
    }
}
//# sourceMappingURL=MemoryConsolidation.js.map