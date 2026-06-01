/**
 * AgentDB v3 - Main database wrapper class
 *
 * Provides a unified interface to all AgentDB controllers with
 * proof-gated mutations via MutationGuard and @ruvector/graph-transformer.
 */
import { ReflexionMemory } from '../controllers/ReflexionMemory.js';
import { SkillLibrary } from '../controllers/SkillLibrary.js';
import { ReasoningBank } from '../controllers/ReasoningBank.js';
import { CausalMemoryGraph } from '../controllers/CausalMemoryGraph.js';
import { CausalRecall } from '../controllers/CausalRecall.js';
import { LearningSystem } from '../controllers/LearningSystem.js';
import { ExplainableRecall } from '../controllers/ExplainableRecall.js';
import { NightlyLearner } from '../controllers/NightlyLearner.js';
import { EmbeddingService } from '../controllers/EmbeddingService.js';
import { createGuardedBackend } from '../backends/factory.js';
import { GraphTransformerService } from '../services/GraphTransformerService.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class AgentDB {
    db;
    reflexion;
    skills;
    reasoning;
    causalGraph;
    causalRecall;
    learningSystem;
    explainableRecall;
    nightlyLearner;
    embedder;
    vectorBackend;
    guardedBackend = null;
    mutationGuard = null;
    attestationLog = null;
    graphTransformer;
    graphAdapter = null;
    initialized = false;
    config;
    constructor(config = {}) {
        this.config = config;
        // db initialized in initialize() after dynamic import
    }
    async initialize() {
        if (this.initialized)
            return;
        // Dynamic import: try better-sqlite3 (native), fallback to sql.js (WASM)
        const dbPath = this.config.dbPath || ':memory:';
        try {
            const Database = (await import('better-sqlite3')).default;
            this.db = new Database(dbPath);
            this.db.pragma('journal_mode = WAL');
            console.log('✅ Using better-sqlite3 (native performance)');
        }
        catch {
            console.log('⚠️  better-sqlite3 unavailable, using sql.js (WASM fallback)');
            const { getDatabaseImplementation } = await import('../db-fallback.js');
            const DatabaseImpl = await getDatabaseImplementation();
            this.db = new DatabaseImpl(dbPath);
        }
        const dim = this.config.dimension ?? 384;
        // Load schemas
        const schemaPath = path.join(__dirname, '../../schemas/schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf-8');
            this.db.exec(schema);
        }
        const frontierSchemaPath = path.join(__dirname, '../../schemas/frontier-schema.sql');
        if (fs.existsSync(frontierSchemaPath)) {
            const frontierSchema = fs.readFileSync(frontierSchemaPath, 'utf-8');
            this.db.exec(frontierSchema);
        }
        // Initialize embedder
        this.embedder = new EmbeddingService({
            model: 'Xenova/all-MiniLM-L6-v2',
            dimension: dim,
            provider: 'transformers'
        });
        await this.embedder.initialize();
        // Initialize GraphTransformerService (8 verified modules)
        this.graphTransformer = new GraphTransformerService();
        await this.graphTransformer.initialize();
        console.log(`[AgentDB] GraphTransformer: ${this.graphTransformer.getEngineType()}`);
        // Initialize proof-gated vector backend (ADR-060)
        let controllerVB = null;
        try {
            const { backend, guard, log } = await createGuardedBackend('auto', {
                dimensions: dim,
                metric: 'cosine',
                maxElements: this.config.maxElements ?? 10000,
                database: this.db,
            });
            this.guardedBackend = backend;
            this.mutationGuard = guard;
            this.attestationLog = log;
            this.vectorBackend = backend;
            controllerVB = backend;
        }
        catch {
            // Guarded backend unavailable — controllers work without vectorBackend
            controllerVB = null;
        }
        // Initialize controllers — wire vectorBackend where supported
        this.reflexion = new ReflexionMemory(this.db, this.embedder, controllerVB ?? undefined);
        this.skills = new SkillLibrary(this.db, this.embedder, controllerVB ?? undefined);
        this.reasoning = new ReasoningBank(this.db, this.embedder, controllerVB ?? undefined);
        this.causalGraph = new CausalMemoryGraph(this.db);
        this.causalRecall = new CausalRecall(this.db, this.embedder);
        this.learningSystem = new LearningSystem(this.db, this.embedder);
        this.explainableRecall = new ExplainableRecall(this.db, this.embedder);
        this.nightlyLearner = new NightlyLearner(this.db, this.embedder);
        // Initialize optional graph database adapter
        try {
            const { GraphDatabaseAdapter } = await import('../backends/graph/GraphDatabaseAdapter.js');
            const storagePath = this.config.dbPath && this.config.dbPath !== ':memory:'
                ? this.config.dbPath.replace(/\.db$/, '') + '.graph'
                : null;
            if (storagePath) {
                this.graphAdapter = new GraphDatabaseAdapter({ storagePath, dimensions: dim }, this.embedder);
                await this.graphAdapter.initialize();
            }
        }
        catch {
            this.graphAdapter = null;
        }
        this.initialized = true;
    }
    getController(name) {
        if (!this.initialized) {
            throw new Error('AgentDB not initialized. Call initialize() first.');
        }
        switch (name) {
            case 'memory':
            case 'reflexion':
                return this.reflexion;
            case 'skills':
                return this.skills;
            case 'reasoning':
            case 'reasoningBank':
                return this.reasoning;
            case 'causal':
            case 'causalGraph':
                return this.causalGraph;
            case 'causalRecall':
                return this.causalRecall;
            case 'learning':
            case 'learningSystem':
                return this.learningSystem;
            case 'explainableRecall':
                return this.explainableRecall;
            case 'nightlyLearner':
                return this.nightlyLearner;
            case 'graph':
            case 'graphAdapter':
                return this.graphAdapter;
            case 'graphTransformer':
                return this.graphTransformer;
            case 'mutationGuard':
                return this.mutationGuard;
            case 'attestationLog':
                return this.attestationLog;
            case 'vectorBackend':
                return this.vectorBackend;
            default:
                throw new Error(`Unknown controller: ${name}`);
        }
    }
    getGraphAdapter() {
        return this.graphAdapter;
    }
    getGraphTransformer() {
        return this.graphTransformer;
    }
    getMutationGuard() {
        return this.mutationGuard;
    }
    async close() {
        if (this.vectorBackend) {
            try {
                this.vectorBackend.close();
            }
            catch { /* ignore */ }
        }
        if (this.db) {
            this.db.close();
        }
    }
    get database() {
        return this.db;
    }
}
//# sourceMappingURL=AgentDB.js.map