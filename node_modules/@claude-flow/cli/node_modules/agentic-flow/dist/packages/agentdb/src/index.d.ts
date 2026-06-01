/**
 * AgentDB - Main Entry Point
 *
 * Frontier Memory Features with MCP Integration:
 * - Causal reasoning and memory graphs
 * - Reflexion memory with self-critique
 * - Skill library with automated learning
 * - Vector search with embeddings
 * - Reinforcement learning (9 algorithms)
 */
export { AgentDB } from './core/AgentDB.js';
export { CausalMemoryGraph } from './controllers/CausalMemoryGraph.js';
export { CausalRecall } from './controllers/CausalRecall.js';
export { ExplainableRecall } from './controllers/ExplainableRecall.js';
export { NightlyLearner } from './controllers/NightlyLearner.js';
export { ReflexionMemory } from './controllers/ReflexionMemory.js';
export { SkillLibrary } from './controllers/SkillLibrary.js';
export { LearningSystem } from './controllers/LearningSystem.js';
export { ReasoningBank } from './controllers/ReasoningBank.js';
export { EmbeddingService } from './controllers/EmbeddingService.js';
export { EnhancedEmbeddingService } from './controllers/EnhancedEmbeddingService.js';
export { WASMVectorSearch } from './controllers/WASMVectorSearch.js';
export { HNSWIndex } from './controllers/HNSWIndex.js';
export { AttentionService } from './controllers/AttentionService.js';
export { createDatabase } from './db-fallback.js';
export { BatchOperations } from './optimizations/BatchOperations.js';
export { QueryOptimizer } from './optimizations/QueryOptimizer.js';
export { RVFOptimizer } from './optimizations/RVFOptimizer.js';
export { validateTableName, validateColumnName, validatePragmaCommand, buildSafeWhereClause, buildSafeSetClause, ValidationError } from './security/input-validation.js';
export { SemanticRouter } from './services/SemanticRouter.js';
export { SonaTrajectoryService } from './services/SonaTrajectoryService.js';
export { LLMRouter } from './services/LLMRouter.js';
export { GraphTransformerService } from './services/GraphTransformerService.js';
export { GNNService } from './services/GNNService.js';
export { RaftConsensus } from './consensus/RaftConsensus.js';
export type { RaftConfig, LogEntry, RaftState } from './consensus/RaftConsensus.js';
export type { RouteResult, RouteConfig } from './services/SemanticRouter.js';
export type { TrajectoryStep, StoredTrajectory, PredictionResult, SonaStats } from './services/SonaTrajectoryService.js';
export type { LLMConfig, LLMResponse } from './services/LLMRouter.js';
export type { GraphTransformerStats } from './services/GraphTransformerService.js';
export type { GNNConfig, IntentResult } from './services/GNNService.js';
export type { RVFConfig } from './optimizations/RVFOptimizer.js';
export { cosineSimilarity, batchCosineSimilarity, distanceToSimilarity, serializeEmbedding, deserializeEmbedding } from './utils/vector-math.js';
export * from './controllers/index.js';
//# sourceMappingURL=index.d.ts.map