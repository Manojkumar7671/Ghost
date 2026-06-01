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
export { CausalMemoryGraph } from './CausalMemoryGraph.js';
export { CausalRecall } from './CausalRecall.js';
export { ExplainableRecall } from './ExplainableRecall.js';
export { NightlyLearner } from './NightlyLearner.js';
export { LearningSystem } from './LearningSystem.js';
export { ReasoningBank } from './ReasoningBank.js';
export { HierarchicalMemory } from './HierarchicalMemory.js';
export { MemoryConsolidation } from './MemoryConsolidation.js';
export type { Episode, EpisodeWithEmbedding, ReflexionQuery } from './ReflexionMemory.js';
export type { Skill, SkillLink, SkillQuery } from './SkillLibrary.js';
export type { EmbeddingConfig } from './EmbeddingService.js';
export type { VectorSearchConfig, VectorSearchResult, VectorIndex } from './WASMVectorSearch.js';
export type { HNSWConfig, HNSWSearchResult, HNSWStats } from './HNSWIndex.js';
export type { EnhancedEmbeddingConfig } from './EnhancedEmbeddingService.js';
export type { MMROptions, MMRCandidate } from './MMRDiversityRanker.js';
export type { MemoryPattern, SynthesizedContext } from './ContextSynthesizer.js';
export type { MetadataFilters, FilterableItem, FilterOperator, FilterValue } from './MetadataFilter.js';
export type { QUICServerConfig, SyncRequest, SyncResponse } from './QUICServer.js';
export type { QUICClientConfig, SyncOptions, SyncResult, SyncProgress } from './QUICClient.js';
export type { QUICConnectionConfig, ConnectionMetrics } from './QUICConnection.js';
export type { PoolConfig, PoolStats } from './QUICConnectionPool.js';
export type { StreamConfig, StreamMetrics, ManagerStats, StreamPriority, StreamState } from './QUICStreamManager.js';
export type { SyncCoordinatorConfig, SyncState, SyncReport } from './SyncCoordinator.js';
export type { AttentionConfig, AttentionResult, AttentionStats } from './AttentionService.js';
export type { CausalEdge, CausalExperiment, CausalObservation, CausalQuery } from './CausalMemoryGraph.js';
export type { CausalRecallResult, RerankConfig, RerankCandidate } from './CausalRecall.js';
export type { RecallCertificate, MerkleProof, JustificationPath } from './ExplainableRecall.js';
export type { LearnerConfig, LearnerReport } from './NightlyLearner.js';
export type { ReasoningPattern, PatternSearchQuery, PatternStats } from './ReasoningBank.js';
export type { LearningSession, LearningConfig, ActionPrediction, ActionFeedback, TrainingResult } from './LearningSystem.js';
export type { MemoryItem, MemoryQuery, MemoryStats, MemoryTier, ImportanceScore, HierarchicalMemoryConfig, ForgettingConfig, ConsolidationConfig } from './HierarchicalMemory.js';
export type { ConsolidationReport, ConsolidationConfig as MemoryConsolidationConfig } from './MemoryConsolidation.js';
export { cosineSimilarity, batchCosineSimilarity, distanceToSimilarity, serializeEmbedding, deserializeEmbedding } from '../utils/vector-math.js';
export { MutationGuard } from '../security/MutationGuard.js';
export { AttestationLog } from '../security/AttestationLog.js';
export type { MutationProof, MutationDenial, AttestationToken, GuardConfig } from '../security/MutationGuard.js';
export { GuardedVectorBackend, ProofDeniedError } from '../backends/ruvector/GuardedVectorBackend.js';
//# sourceMappingURL=index.d.ts.map