import type { MutationGuard } from '../security/MutationGuard.js';
import { GraphTransformerService } from '../services/GraphTransformerService.js';
export interface AgentDBConfig {
    dbPath?: string;
    namespace?: string;
    dimension?: number;
    maxElements?: number;
    enableAttention?: boolean;
    attentionConfig?: Record<string, any>;
}
export declare class AgentDB {
    private db;
    private reflexion;
    private skills;
    private reasoning;
    private causalGraph;
    private causalRecall;
    private learningSystem;
    private explainableRecall;
    private nightlyLearner;
    private embedder;
    private vectorBackend;
    private guardedBackend;
    private mutationGuard;
    private attestationLog;
    private graphTransformer;
    private graphAdapter;
    private initialized;
    private config;
    constructor(config?: AgentDBConfig);
    initialize(): Promise<void>;
    getController(name: string): any;
    getGraphAdapter(): any;
    getGraphTransformer(): GraphTransformerService;
    getMutationGuard(): MutationGuard | null;
    close(): Promise<void>;
    get database(): any;
}
//# sourceMappingURL=AgentDB.d.ts.map