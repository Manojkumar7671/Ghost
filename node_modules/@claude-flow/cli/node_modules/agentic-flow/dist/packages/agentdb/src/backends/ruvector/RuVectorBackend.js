/**
 * RuVectorBackend - High-Performance Vector Storage (v0.1.99+)
 *
 * Implements VectorBackend using ruvector with native SIMD and multi-threading.
 * Updated for ruvector 0.1.99+ async API with object-style insert/search.
 *
 * Features:
 * - Native SIMD acceleration (2-4x faster vector ops)
 * - Automatic fallback when ruvector packages not installed
 * - Separate metadata storage for rich queries
 * - Score-to-similarity conversion for all metrics
 * - Batch operations for optimal throughput
 * - Parallel batch search via searchBatch()
 * - Persistent storage with separate metadata files
 */
export class RuVectorBackend {
    name = 'ruvector';
    db; // VectorDB from ruvector 0.1.99+
    config;
    metadata = new Map();
    initialized = false;
    learning = null;
    nativeVersion = 'unknown';
    isNativeImpl = false;
    constructor(config) {
        // Handle both dimension and dimensions for backward compatibility
        const dimension = config.dimension ?? config.dimensions;
        if (!dimension) {
            throw new Error('Vector dimension is required (use dimension or dimensions)');
        }
        // Store both forms for compatibility with different backends
        this.config = { ...config, dimension, dimensions: dimension };
    }
    /**
     * Initialize RuVector database with SIMD and multi-threading (0.1.99+)
     */
    async initialize() {
        if (this.initialized)
            return;
        try {
            // Try main ruvector package first (0.1.99+ with native SIMD)
            let VectorDB;
            let ruvectorModule;
            try {
                ruvectorModule = await import('ruvector');
                VectorDB = ruvectorModule.VectorDB || ruvectorModule.default?.VectorDB;
            }
            catch {
                // Fallback to @ruvector/core for backward compatibility
                ruvectorModule = await import('@ruvector/core');
                VectorDB = ruvectorModule.VectorDB || ruvectorModule.default?.VectorDB;
            }
            if (!VectorDB) {
                throw new Error('Could not find VectorDB export in ruvector');
            }
            // Handle both 'dimension' and 'dimensions' for backward compatibility
            const dimensions = this.config.dimension ?? this.config.dimensions;
            if (!dimensions) {
                throw new Error('Vector dimension is required (use dimension or dimensions)');
            }
            // RuVector 0.1.99+ constructor - uses 'dimensions' (plural)
            this.db = new VectorDB({
                dimensions: dimensions,
                metric: this.config.metric,
                maxElements: this.config.maxElements || 100000,
                efConstruction: this.config.efConstruction || 200,
                m: this.config.M || 16
            });
            // Detect native SIMD availability
            if (ruvectorModule.isNative) {
                this.isNativeImpl = ruvectorModule.isNative();
            }
            if (ruvectorModule.getVersion) {
                const vInfo = ruvectorModule.getVersion();
                this.nativeVersion = typeof vInfo === 'string' ? vInfo : vInfo?.version || 'unknown';
            }
            this.initialized = true;
        }
        catch (error) {
            const errorMessage = error.message;
            if (errorMessage.includes('Path traversal') || errorMessage.includes('Invalid path')) {
                throw new Error(`RuVector does not support :memory: database paths.\n` +
                    `Use a file path instead, or RuVector will be skipped and fallback backend will be used.\n` +
                    `Original error: ${errorMessage}`);
            }
            throw new Error(`RuVector initialization failed. Please install: npm install ruvector@latest\n` +
                `Or legacy packages: npm install @ruvector/core\n` +
                `Error: ${errorMessage}`);
        }
    }
    /**
     * Insert single vector with optional metadata.
     * Uses ruvector 0.1.99+ object-style API: insert({ id, vector, metadata? })
     */
    insert(id, embedding, metadata) {
        this.ensureInitialized();
        // ruvector 0.1.99+ uses object-style insert with async support
        // The VectorBackend interface is sync, so we call without awaiting.
        // The underlying native impl handles this via napi-rs sync path.
        const entry = {
            id,
            vector: Array.from(embedding)
        };
        if (metadata) {
            entry.metadata = metadata;
            this.metadata.set(id, metadata);
        }
        // ruvector 0.1.99+ insert returns a promise, but the native layer
        // executes synchronously. We fire-and-forget for interface compat.
        const result = this.db.insert(entry);
        if (result && typeof result.catch === 'function') {
            result.catch((err) => {
                console.error(`[RuVectorBackend] Insert failed for ${id}: ${err.message}`);
            });
        }
    }
    /**
     * Batch insert for optimal performance.
     * Uses ruvector 0.1.99+ insertBatch([{ id, vector, metadata? }])
     */
    insertBatch(items) {
        this.ensureInitialized();
        const entries = items.map(item => {
            const entry = {
                id: item.id,
                vector: Array.from(item.embedding)
            };
            if (item.metadata) {
                entry.metadata = item.metadata;
                this.metadata.set(item.id, item.metadata);
            }
            return entry;
        });
        const result = this.db.insertBatch(entries);
        if (result && typeof result.catch === 'function') {
            result.catch((err) => {
                console.error(`[RuVectorBackend] Batch insert failed: ${err.message}`);
            });
        }
    }
    /**
     * Set a RuVectorLearning instance for GNN-enhanced search
     */
    setLearning(learning) {
        this.learning = learning;
    }
    /**
     * Get the current RuVectorLearning instance, if any
     */
    getLearning() {
        return this.learning;
    }
    /**
     * Search for k-nearest neighbors with optional filtering and GNN enhancement.
     * Uses ruvector 0.1.99+ search({ vector, k, efSearch?, filter? })
     * Results contain { id, score, vector?, metadata? }
     */
    search(query, k, options) {
        this.ensureInitialized();
        // Build search query for ruvector 0.1.99+ API
        const searchQuery = {
            vector: Array.from(query),
            k
        };
        if (options?.efSearch) {
            searchQuery.efSearch = options.efSearch;
        }
        if (options?.filter) {
            searchQuery.filter = options.filter;
        }
        // ruvector 0.1.99+ search is async but native layer is sync
        let rawResults = [];
        const searchPromise = this.db.search(searchQuery);
        if (searchPromise && typeof searchPromise.then === 'function') {
            // Synchronous extraction for interface compat - the native binding
            // resolves immediately when using N-API sync path
            // For truly async scenarios, use searchBatch() instead
            let resolved = false;
            searchPromise.then((r) => {
                rawResults = r || [];
                resolved = true;
            });
            // If promise resolved synchronously (common with native bindings)
            if (!resolved) {
                // Fallback: return empty and log warning
                console.warn('[RuVectorBackend] Search returned async promise; use searchBatch() for async searches');
                return [];
            }
        }
        else {
            rawResults = searchPromise || [];
        }
        // Convert ruvector 0.1.99+ results (score-based) to SearchResult format
        let results = rawResults
            .map((r) => ({
            id: r.id,
            distance: this.scoreToDistance(r.score),
            similarity: r.score,
            metadata: r.metadata || this.metadata.get(r.id)
        }))
            .filter((r) => {
            if (options?.threshold && r.similarity < options.threshold) {
                return false;
            }
            if (options?.filter && r.metadata) {
                return Object.entries(options.filter).every(([key, value]) => r.metadata[key] === value);
            }
            return true;
        });
        // Enhance with GNN if available
        if (this.learning && this.learning.getState().initialized && results.length > 0) {
            try {
                const neighbors = [];
                const weights = [];
                for (const r of results) {
                    weights.push(r.similarity);
                    neighbors.push(query);
                }
                for (let i = 0; i < rawResults.length && i < results.length; i++) {
                    const raw = rawResults[i];
                    if (raw.vector) {
                        const vec = raw.vector instanceof Float32Array
                            ? raw.vector
                            : new Float32Array(Object.values(raw.vector));
                        neighbors[i] = vec;
                    }
                }
                const enhanced = this.learning.enhance(query, neighbors, weights);
                if (enhanced && enhanced.length > 0) {
                    const enhancedQuery = {
                        vector: Array.from(enhanced),
                        k
                    };
                    if (options?.efSearch)
                        enhancedQuery.efSearch = options.efSearch;
                    const enhancedPromise = this.db.search(enhancedQuery);
                    let enhancedRaw = [];
                    if (enhancedPromise && typeof enhancedPromise.then === 'function') {
                        let resolved = false;
                        enhancedPromise.then((r) => { enhancedRaw = r || []; resolved = true; });
                        if (!resolved)
                            return results;
                    }
                    else {
                        enhancedRaw = enhancedPromise || [];
                    }
                    const enhancedResults = enhancedRaw
                        .map((r) => ({
                        id: r.id,
                        distance: this.scoreToDistance(r.score),
                        similarity: r.score,
                        metadata: r.metadata || this.metadata.get(r.id)
                    }))
                        .filter((r) => {
                        if (options?.threshold && r.similarity < options.threshold)
                            return false;
                        if (options?.filter && r.metadata) {
                            return Object.entries(options.filter).every(([key, value]) => r.metadata[key] === value);
                        }
                        return true;
                    });
                    if (enhancedResults.length > 0) {
                        results = enhancedResults;
                    }
                }
            }
            catch {
                // Fall through to raw results if GNN enhancement fails
            }
        }
        return results;
    }
    /**
     * Batch search for parallel query processing (0.1.99+).
     * Executes multiple searches concurrently for throughput.
     */
    async searchBatch(queries, k, options) {
        this.ensureInitialized();
        const results = await Promise.all(queries.map(async (query) => {
            const searchQuery = {
                vector: Array.from(query),
                k
            };
            if (options?.efSearch)
                searchQuery.efSearch = options.efSearch;
            if (options?.filter)
                searchQuery.filter = options.filter;
            const rawResults = await this.db.search(searchQuery);
            return (rawResults || []).map((r) => ({
                id: r.id,
                distance: this.scoreToDistance(r.score),
                similarity: r.score,
                metadata: r.metadata || this.metadata.get(r.id)
            })).filter((r) => {
                if (options?.threshold && r.similarity < options.threshold)
                    return false;
                if (options?.filter && r.metadata) {
                    return Object.entries(options.filter).every(([key, value]) => r.metadata[key] === value);
                }
                return true;
            });
        }));
        return results;
    }
    /**
     * Remove vector by ID.
     * Uses ruvector 0.1.99+ delete(id) instead of remove(id)
     */
    remove(id) {
        this.ensureInitialized();
        this.metadata.delete(id);
        try {
            const result = this.db.delete(id);
            // Handle async result
            if (result && typeof result.then === 'function') {
                let resolved = false;
                let success = false;
                result.then((r) => { success = r; resolved = true; });
                if (resolved)
                    return success;
                // Fire-and-forget for async case
                result.catch(() => { });
                return true;
            }
            return result !== false;
        }
        catch {
            return false;
        }
    }
    /**
     * Get database statistics including native SIMD status
     */
    getStats() {
        this.ensureInitialized();
        let count = 0;
        const lenResult = this.db.len();
        if (lenResult && typeof lenResult.then === 'function') {
            let resolved = false;
            lenResult.then((c) => { count = c; resolved = true; });
            if (!resolved)
                count = this.metadata.size; // fallback
        }
        else {
            count = lenResult || 0;
        }
        return {
            count,
            dimension: this.config.dimension || 384,
            metric: this.config.metric,
            backend: 'ruvector',
            memoryUsage: 0,
            // Extended stats for 0.1.99+
            ...(this.isNativeImpl && {
                nativeVersion: this.nativeVersion,
                simdEnabled: true,
                implementation: 'native'
            })
        };
    }
    /**
     * Get extended stats including SIMD and version info
     */
    getExtendedStats() {
        const base = this.getStats();
        return {
            count: base.count,
            dimension: base.dimension,
            metric: base.metric,
            backend: base.backend,
            nativeVersion: this.nativeVersion,
            isNative: this.isNativeImpl,
            simdEnabled: this.isNativeImpl
        };
    }
    /**
     * Save index and metadata to disk
     */
    async save(path) {
        this.ensureInitialized();
        // Save vector index (if ruvector supports it)
        if (typeof this.db.save === 'function') {
            await this.db.save(path);
        }
        // Save metadata separately as JSON
        const metadataPath = path + '.meta.json';
        const fs = await import('fs/promises');
        await fs.writeFile(metadataPath, JSON.stringify(Object.fromEntries(this.metadata), null, 2));
    }
    /**
     * Load index and metadata from disk
     */
    async load(path) {
        this.ensureInitialized();
        // Load vector index (if ruvector supports it)
        if (typeof this.db.load === 'function') {
            await this.db.load(path);
        }
        // Load metadata
        const metadataPath = path + '.meta.json';
        try {
            const fs = await import('fs/promises');
            const data = await fs.readFile(metadataPath, 'utf-8');
            this.metadata = new Map(Object.entries(JSON.parse(data)));
        }
        catch {
            console.debug(`[RuVectorBackend] No metadata file found at ${metadataPath}`);
        }
    }
    /**
     * Close and cleanup resources
     */
    close() {
        this.metadata.clear();
    }
    /**
     * Convert score to distance for backward compatibility.
     * ruvector 0.1.99+ returns scores (higher = more similar).
     */
    scoreToDistance(score) {
        switch (this.config.metric) {
            case 'cosine':
                return 1 - score;
            case 'l2':
                return score === 0 ? Infinity : -Math.log(score);
            case 'ip':
                return -score;
            default:
                return 1 - score;
        }
    }
    /**
     * Ensure database is initialized before operations
     */
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error('RuVectorBackend not initialized. Call initialize() first.');
        }
    }
}
//# sourceMappingURL=RuVectorBackend.js.map