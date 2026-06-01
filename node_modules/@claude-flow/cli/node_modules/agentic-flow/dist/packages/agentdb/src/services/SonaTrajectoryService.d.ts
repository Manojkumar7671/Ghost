/**
 * SonaTrajectoryService - Wraps @ruvector/sona for trajectory learning
 *
 * Provides trajectory recording and action prediction for agent learning.
 * Uses @ruvector/sona for reinforcement learning when available,
 * otherwise falls back to in-memory trajectory storage with simple
 * frequency-based prediction.
 *
 * Usage:
 *   const sona = new SonaTrajectoryService();
 *   await sona.initialize();
 *
 *   // Record agent trajectories
 *   await sona.recordTrajectory('coder', [
 *     { state: { task: 'implement' }, action: 'write_code', reward: 0.8 },
 *     { state: { task: 'test' }, action: 'run_tests', reward: 0.9 }
 *   ]);
 *
 *   // Predict next action
 *   const prediction = await sona.predict({ task: 'implement' });
 */
export interface TrajectoryStep {
    state: any;
    action: string;
    reward: number;
}
export interface StoredTrajectory {
    steps: TrajectoryStep[];
    reward: number;
}
export interface PredictionResult {
    action: string;
    confidence: number;
}
export interface SonaStats {
    available: boolean;
    trajectoryCount: number;
    agentTypes: string[];
}
export interface PolicyGradientConfig {
    learningRate: number;
    gamma: number;
    epsilon: number;
    entropyCoeff: number;
}
export interface ValueFunctionConfig {
    learningRate: number;
    gamma: number;
    lambda: number;
}
export interface ExperienceReplayConfig {
    bufferSize: number;
    batchSize: number;
    priorityAlpha: number;
    priorityBeta: number;
}
export interface RLMetrics {
    episodeReward: number;
    avgReward: number;
    loss: number;
    epsilon: number;
    iterationCount: number;
}
export declare class SonaTrajectoryService {
    private sona;
    private available;
    private engineType;
    private trajectories;
    private policyConfig;
    private valueConfig;
    private replayConfig;
    private experienceBuffer;
    private metrics;
    private policyWeights;
    private valueWeights;
    /**
     * Initialize the trajectory service
     *
     * ADR-062 Phase 2: Tries native @ruvector/sona (NAPI-RS) first,
     * falls back to in-memory trajectory storage. Reports engine type.
     *
     * @returns true if @ruvector/sona was loaded, false if using fallback
     */
    initialize(): Promise<boolean>;
    /**
     * Get the active engine type: 'native' or 'js'
     */
    getEngineType(): string;
    /**
     * Record a trajectory for an agent type
     *
     * When @ruvector/sona is available, steps are forwarded to the RL engine.
     * Otherwise, trajectories are stored in memory for pattern analysis.
     *
     * @param agentType - Type of agent (e.g., 'coder', 'reviewer')
     * @param steps - Sequence of state-action-reward tuples
     */
    recordTrajectory(agentType: string, steps: TrajectoryStep[]): Promise<void>;
    /**
     * Predict the next action given a state
     *
     * When @ruvector/sona is available, uses the RL model for prediction.
     * Otherwise, uses frequency-based prediction from stored trajectories.
     *
     * @param state - Current state to predict action for
     * @returns Predicted action and confidence score
     */
    predict(state: any): Promise<PredictionResult>;
    /**
     * Get trajectory patterns, optionally filtered by agent type
     *
     * When @ruvector/sona is available, queries the RL engine for patterns.
     * Otherwise, returns stored trajectories.
     *
     * @param agentType - Optional agent type filter
     * @returns Array of trajectory patterns
     */
    getPatterns(agentType?: string): Promise<StoredTrajectory[]>;
    /**
     * Check if @ruvector/sona is available
     */
    isAvailable(): boolean;
    /**
     * Get service statistics
     */
    getStats(): SonaStats;
    /**
     * Clear all stored trajectories for an agent type, or all if not specified
     */
    clear(agentType?: string): void;
    /**
     * Frequency-based action prediction from stored trajectories
     */
    private frequencyPredict;
    /**
     * Train policy using Policy Gradient (REINFORCE with baseline)
     *
     * @param episodes - Array of trajectories to learn from
     * @param config - Optional policy gradient configuration
     * @returns Training loss
     */
    trainPolicy(episodes: StoredTrajectory[], config?: Partial<PolicyGradientConfig>): Promise<number>;
    /**
     * Estimate value function using TD learning
     *
     * @param state - State to estimate value for
     * @param reward - Observed reward
     * @param nextState - Next state
     * @param config - Optional value function configuration
     * @returns Estimated value
     */
    estimateValue(state: any, reward: number, nextState: any, config?: Partial<ValueFunctionConfig>): Promise<number>;
    /**
     * Add experience to replay buffer with priority sampling
     *
     * @param state - Current state
     * @param action - Action taken
     * @param reward - Reward received
     * @param nextState - Resulting state
     * @param priority - Experience priority (default: 1.0)
     */
    addExperience(state: any, action: string, reward: number, nextState: any, priority?: number): void;
    /**
     * Sample batch from experience replay buffer with priority sampling
     *
     * @param batchSize - Optional batch size (default: from config)
     * @returns Batch of experiences
     */
    sampleExperience(batchSize?: number): Array<{
        state: any;
        action: string;
        reward: number;
        nextState: any;
    }>;
    /**
     * Multi-agent reinforcement learning coordination
     *
     * @param agentStates - Map of agent IDs to their states
     * @param jointAction - Joint action taken by all agents
     * @param jointReward - Shared reward
     * @returns Individual rewards for each agent
     */
    multiAgentLearn(agentStates: Map<string, any>, jointAction: Map<string, string>, jointReward: number): Promise<Map<string, number>>;
    /**
     * Transfer learning: apply knowledge from source task to target task
     *
     * @param sourceAgent - Agent type to transfer from
     * @param targetAgent - Agent type to transfer to
     * @param transferRatio - How much knowledge to transfer (0-1)
     * @returns Success indicator
     */
    transferLearning(sourceAgent: string, targetAgent: string, transferRatio?: number): Promise<boolean>;
    /**
     * Continuous learning: update model with new experience
     *
     * @param state - Current state
     * @param action - Action taken
     * @param reward - Reward received
     * @param nextState - Resulting state
     * @returns Updated value estimate
     */
    continuousLearn(state: any, action: string, reward: number, nextState: any): Promise<number>;
    /**
     * Get current RL metrics
     */
    getRLMetrics(): RLMetrics;
    /**
     * Reset RL state (for new training session)
     */
    resetRL(): void;
    /**
     * Configure RL parameters
     */
    configureRL(config: {
        policy?: Partial<PolicyGradientConfig>;
        value?: Partial<ValueFunctionConfig>;
        replay?: Partial<ExperienceReplayConfig>;
    }): void;
    /**
     * Calculate agent contribution to joint reward (simplified)
     */
    private calculateContribution;
}
//# sourceMappingURL=SonaTrajectoryService.d.ts.map