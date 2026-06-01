/**
 * AgentDB Controllers - State-of-the-Art Memory Systems
 *
 * Export all memory controllers for agent systems
 */
export { ReflexionMemory } from './ReflexionMemory.js';
export { SkillLibrary } from './SkillLibrary.js';
export { EmbeddingService } from './EmbeddingService.js';
export { WASMVectorSearch } from './WASMVectorSearch.js';
export { HNSWIndex } from './HNSWIndex.js';
export { EnhancedEmbeddingService } from './EnhancedEmbeddingService.js';
export { MMRDiversityRanker } from './MMRDiversityRanker.js';
export { ContextSynthesizer } from './ContextSynthesizer.js';
export { MetadataFilter } from './MetadataFilter.js';
export { QUICServer } from './QUICServer.js';
export { QUICClient } from './QUICClient.js';
export { QUICConnection } from './QUICConnection.js';
export { QUICConnectionPool } from './QUICConnectionPool.js';
export { QUICStreamManager } from './QUICStreamManager.js';
export { SyncCoordinator } from './SyncCoordinator.js';
export { AttentionService } from './AttentionService.js';
// Controllers previously missing from barrel (ADR-060 Issue 3)
export { CausalMemoryGraph } from './CausalMemoryGraph.js';
export { CausalRecall } from './CausalRecall.js';
export { ExplainableRecall } from './ExplainableRecall.js';
export { NightlyLearner } from './NightlyLearner.js';
export { LearningSystem } from './LearningSystem.js';
export { ReasoningBank } from './ReasoningBank.js';
// Hierarchical Memory (ADR-066 Phase P2-3)
export { HierarchicalMemory } from './HierarchicalMemory.js';
export { MemoryConsolidation } from './MemoryConsolidation.js';
export { cosineSimilarity, batchCosineSimilarity, distanceToSimilarity, serializeEmbedding, deserializeEmbedding } from '../utils/vector-math.js';
// Security - Proof-Gated Mutation (ADR-060)
export { MutationGuard } from '../security/MutationGuard.js';
export { AttestationLog } from '../security/AttestationLog.js';
export { GuardedVectorBackend, ProofDeniedError } from '../backends/ruvector/GuardedVectorBackend.js';
//# sourceMappingURL=index.js.map