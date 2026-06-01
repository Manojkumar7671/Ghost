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
// Main AgentDB class
export { AgentDB } from './core/AgentDB.js';
// Core controllers
export { CausalMemoryGraph } from './controllers/CausalMemoryGraph.js';
export { CausalRecall } from './controllers/CausalRecall.js';
export { ExplainableRecall } from './controllers/ExplainableRecall.js';
export { NightlyLearner } from './controllers/NightlyLearner.js';
export { ReflexionMemory } from './controllers/ReflexionMemory.js';
export { SkillLibrary } from './controllers/SkillLibrary.js';
export { LearningSystem } from './controllers/LearningSystem.js';
export { ReasoningBank } from './controllers/ReasoningBank.js';
// Embedding services
export { EmbeddingService } from './controllers/EmbeddingService.js';
export { EnhancedEmbeddingService } from './controllers/EnhancedEmbeddingService.js';
// WASM acceleration and HNSW indexing
export { WASMVectorSearch } from './controllers/WASMVectorSearch.js';
export { HNSWIndex } from './controllers/HNSWIndex.js';
// Attention mechanisms
export { AttentionService } from './controllers/AttentionService.js';
// Database utilities
export { createDatabase } from './db-fallback.js';
// Optimizations
export { BatchOperations } from './optimizations/BatchOperations.js';
export { QueryOptimizer } from './optimizations/QueryOptimizer.js';
export { RVFOptimizer } from './optimizations/RVFOptimizer.js';
// Security
export { validateTableName, validateColumnName, validatePragmaCommand, buildSafeWhereClause, buildSafeSetClause, ValidationError } from './security/input-validation.js';
// Services - RuVector package integrations
export { SemanticRouter } from './services/SemanticRouter.js';
export { SonaTrajectoryService } from './services/SonaTrajectoryService.js';
export { LLMRouter } from './services/LLMRouter.js';
export { GraphTransformerService } from './services/GraphTransformerService.js';
export { GNNService } from './services/GNNService.js';
// Consensus - Distributed coordination
export { RaftConsensus } from './consensus/RaftConsensus.js';
// Vector math utilities
export { cosineSimilarity, batchCosineSimilarity, distanceToSimilarity, serializeEmbedding, deserializeEmbedding } from './utils/vector-math.js';
// Re-export all controllers for convenience
export * from './controllers/index.js';
//# sourceMappingURL=index.js.map