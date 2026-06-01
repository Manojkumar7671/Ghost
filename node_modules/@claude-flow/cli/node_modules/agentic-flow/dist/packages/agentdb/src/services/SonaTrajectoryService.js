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
export class SonaTrajectoryService {
    sona = null;
    available = false;
    engineType = 'js';
    trajectories = new Map();
    // RL Training state
    policyConfig = {
        learningRate: 0.001,
        gamma: 0.99,
        epsilon: 0.1,
        entropyCoeff: 0.01
    };
    valueConfig = {
        learningRate: 0.001,
        gamma: 0.99,
        lambda: 0.95
    };
    replayConfig = {
        bufferSize: 10000,
        batchSize: 32,
        priorityAlpha: 0.6,
        priorityBeta: 0.4
    };
    experienceBuffer = [];
    metrics = {
        episodeReward: 0,
        avgReward: 0,
        loss: 0,
        epsilon: 0.1,
        iterationCount: 0
    };
    policyWeights = new Map();
    valueWeights = new Map();
    /**
     * Initialize the trajectory service
     *
     * ADR-062 Phase 2: Tries native @ruvector/sona (NAPI-RS) first,
     * falls back to in-memory trajectory storage. Reports engine type.
     *
     * @returns true if @ruvector/sona was loaded, false if using fallback
     */
    async initialize() {
        try {
            const mod = await import('@ruvector/sona');
            const SONA = mod.SONA || mod.Sona ||
                mod.default?.SONA || mod.default?.Sona ||
                mod.default;
            if (SONA && typeof SONA === 'function') {
                this.sona = new SONA();
                this.available = true;
                this.engineType = 'native';
                console.log('[SonaTrajectoryService] Using native @ruvector/sona');
                return true;
            }
            else if (SONA && typeof SONA === 'object') {
                this.sona = SONA;
                this.available = true;
                this.engineType = 'native';
                console.log('[SonaTrajectoryService] Using native @ruvector/sona');
                return true;
            }
            this.available = false;
            this.engineType = 'js';
            return false;
        }
        catch {
            this.available = false;
            this.engineType = 'js';
            return false;
        }
    }
    /**
     * Get the active engine type: 'native' or 'js'
     */
    getEngineType() {
        return this.engineType;
    }
    /**
     * Record a trajectory for an agent type
     *
     * When @ruvector/sona is available, steps are forwarded to the RL engine.
     * Otherwise, trajectories are stored in memory for pattern analysis.
     *
     * @param agentType - Type of agent (e.g., 'coder', 'reviewer')
     * @param steps - Sequence of state-action-reward tuples
     */
    async recordTrajectory(agentType, steps) {
        if (steps.length === 0)
            return;
        const totalReward = steps.reduce((sum, s) => sum + s.reward, 0) / steps.length;
        // Try @ruvector/sona first
        if (this.sona) {
            try {
                for (const step of steps) {
                    if (typeof this.sona.recordStep === 'function') {
                        await this.sona.recordStep(step);
                    }
                    else if (typeof this.sona.record === 'function') {
                        await this.sona.record(step);
                    }
                    else if (typeof this.sona.addStep === 'function') {
                        await this.sona.addStep(step.state, step.action, step.reward);
                    }
                }
                // Also store in-memory for local pattern access
            }
            catch {
                // Fall through to in-memory storage
            }
        }
        // In-memory storage (always maintained for local analysis)
        if (!this.trajectories.has(agentType)) {
            this.trajectories.set(agentType, []);
        }
        this.trajectories.get(agentType).push({ steps, reward: totalReward });
    }
    /**
     * Predict the next action given a state
     *
     * When @ruvector/sona is available, uses the RL model for prediction.
     * Otherwise, uses frequency-based prediction from stored trajectories.
     *
     * @param state - Current state to predict action for
     * @returns Predicted action and confidence score
     */
    async predict(state) {
        // Try @ruvector/sona first
        if (this.sona) {
            try {
                let result;
                if (typeof this.sona.predict === 'function') {
                    result = await this.sona.predict(state);
                }
                else if (typeof this.sona.selectAction === 'function') {
                    result = await this.sona.selectAction(state);
                }
                if (result) {
                    return {
                        action: result.action || result.name || String(result),
                        confidence: result.confidence || result.probability || 0.8
                    };
                }
            }
            catch {
                // Fall through to frequency-based prediction
            }
        }
        // Frequency-based fallback: find the most common action across trajectories
        return this.frequencyPredict();
    }
    /**
     * Get trajectory patterns, optionally filtered by agent type
     *
     * When @ruvector/sona is available, queries the RL engine for patterns.
     * Otherwise, returns stored trajectories.
     *
     * @param agentType - Optional agent type filter
     * @returns Array of trajectory patterns
     */
    async getPatterns(agentType) {
        // Try @ruvector/sona first
        if (this.sona) {
            try {
                if (typeof this.sona.findPatterns === 'function') {
                    const patterns = await this.sona.findPatterns();
                    if (patterns && Array.isArray(patterns) && patterns.length > 0) {
                        return patterns;
                    }
                }
                else if (typeof this.sona.getPatterns === 'function') {
                    const patterns = await this.sona.getPatterns();
                    if (patterns && Array.isArray(patterns) && patterns.length > 0) {
                        return patterns;
                    }
                }
            }
            catch {
                // Fall through to in-memory trajectories
            }
        }
        if (agentType) {
            return this.trajectories.get(agentType) || [];
        }
        return Array.from(this.trajectories.values()).flat();
    }
    /**
     * Check if @ruvector/sona is available
     */
    isAvailable() {
        return this.available;
    }
    /**
     * Get service statistics
     */
    getStats() {
        return {
            available: this.available,
            trajectoryCount: Array.from(this.trajectories.values())
                .reduce((sum, arr) => sum + arr.length, 0),
            agentTypes: Array.from(this.trajectories.keys())
        };
    }
    /**
     * Clear all stored trajectories for an agent type, or all if not specified
     */
    clear(agentType) {
        if (agentType) {
            this.trajectories.delete(agentType);
        }
        else {
            this.trajectories.clear();
        }
    }
    /**
     * Frequency-based action prediction from stored trajectories
     */
    frequencyPredict() {
        const actionCounts = new Map();
        for (const trajectories of this.trajectories.values()) {
            for (const traj of trajectories) {
                for (const step of traj.steps) {
                    const entry = actionCounts.get(step.action) || { count: 0, totalReward: 0 };
                    entry.count++;
                    entry.totalReward += step.reward;
                    actionCounts.set(step.action, entry);
                }
            }
        }
        if (actionCounts.size === 0) {
            return { action: 'default', confidence: 0.5 };
        }
        // Find action with highest average reward
        let bestAction = 'default';
        let bestAvgReward = -Infinity;
        let totalActions = 0;
        for (const [action, entry] of actionCounts) {
            totalActions += entry.count;
            const avgReward = entry.totalReward / entry.count;
            if (avgReward > bestAvgReward) {
                bestAvgReward = avgReward;
                bestAction = action;
            }
        }
        // Confidence based on the proportion of observations
        const bestCount = actionCounts.get(bestAction)?.count || 0;
        const confidence = Math.min(0.95, bestCount / Math.max(totalActions, 1));
        return { action: bestAction, confidence };
    }
    // ==================== RL Training Methods ====================
    /**
     * Train policy using Policy Gradient (REINFORCE with baseline)
     *
     * @param episodes - Array of trajectories to learn from
     * @param config - Optional policy gradient configuration
     * @returns Training loss
     */
    async trainPolicy(episodes, config) {
        if (config) {
            this.policyConfig = { ...this.policyConfig, ...config };
        }
        let totalLoss = 0;
        let episodeCount = 0;
        for (const episode of episodes) {
            const returns = [];
            let G = 0;
            // Calculate returns (backwards)
            for (let t = episode.steps.length - 1; t >= 0; t--) {
                G = episode.steps[t].reward + this.policyConfig.gamma * G;
                returns.unshift(G);
            }
            // Calculate baseline (average return)
            const baseline = returns.reduce((a, b) => a + b, 0) / returns.length;
            // Update policy for each step
            for (let t = 0; t < episode.steps.length; t++) {
                const step = episode.steps[t];
                const advantage = returns[t] - baseline;
                // Get or initialize policy weights for this action
                const actionKey = step.action;
                if (!this.policyWeights.has(actionKey)) {
                    this.policyWeights.set(actionKey, [0]);
                }
                const weights = this.policyWeights.get(actionKey);
                const gradient = advantage * this.policyConfig.learningRate;
                weights[0] += gradient;
                totalLoss += Math.abs(advantage);
            }
            episodeCount++;
        }
        // Update metrics
        this.metrics.loss = totalLoss / Math.max(episodeCount, 1);
        this.metrics.iterationCount++;
        // Decay epsilon (exploration rate)
        this.metrics.epsilon = Math.max(0.01, this.policyConfig.epsilon * 0.995);
        this.policyConfig.epsilon = this.metrics.epsilon;
        return this.metrics.loss;
    }
    /**
     * Estimate value function using TD learning
     *
     * @param state - State to estimate value for
     * @param reward - Observed reward
     * @param nextState - Next state
     * @param config - Optional value function configuration
     * @returns Estimated value
     */
    async estimateValue(state, reward, nextState, config) {
        if (config) {
            this.valueConfig = { ...this.valueConfig, ...config };
        }
        const stateKey = JSON.stringify(state);
        const nextStateKey = JSON.stringify(nextState);
        // Get or initialize value estimates
        const currentValue = this.valueWeights.get(stateKey) || 0;
        const nextValue = this.valueWeights.get(nextStateKey) || 0;
        // TD error: δ = r + γV(s') - V(s)
        const tdError = reward + this.valueConfig.gamma * nextValue - currentValue;
        // Update value function: V(s) ← V(s) + α·δ
        const newValue = currentValue + this.valueConfig.learningRate * tdError;
        this.valueWeights.set(stateKey, newValue);
        return newValue;
    }
    /**
     * Add experience to replay buffer with priority sampling
     *
     * @param state - Current state
     * @param action - Action taken
     * @param reward - Reward received
     * @param nextState - Resulting state
     * @param priority - Experience priority (default: 1.0)
     */
    addExperience(state, action, reward, nextState, priority = 1.0) {
        // Add to buffer
        this.experienceBuffer.push({ state, action, reward, nextState, priority });
        // Maintain buffer size
        if (this.experienceBuffer.length > this.replayConfig.bufferSize) {
            this.experienceBuffer.shift();
        }
    }
    /**
     * Sample batch from experience replay buffer with priority sampling
     *
     * @param batchSize - Optional batch size (default: from config)
     * @returns Batch of experiences
     */
    sampleExperience(batchSize) {
        const size = batchSize || this.replayConfig.batchSize;
        if (this.experienceBuffer.length === 0) {
            return [];
        }
        // Calculate probability distribution based on priorities
        const totalPriority = this.experienceBuffer.reduce((sum, exp) => sum + Math.pow(exp.priority, this.replayConfig.priorityAlpha), 0);
        const batch = [];
        for (let i = 0; i < Math.min(size, this.experienceBuffer.length); i++) {
            // Priority sampling
            let rand = Math.random() * totalPriority;
            let selectedExp = this.experienceBuffer[0];
            for (const exp of this.experienceBuffer) {
                rand -= Math.pow(exp.priority, this.replayConfig.priorityAlpha);
                if (rand <= 0) {
                    selectedExp = exp;
                    break;
                }
            }
            batch.push({
                state: selectedExp.state,
                action: selectedExp.action,
                reward: selectedExp.reward,
                nextState: selectedExp.nextState
            });
        }
        return batch;
    }
    /**
     * Multi-agent reinforcement learning coordination
     *
     * @param agentStates - Map of agent IDs to their states
     * @param jointAction - Joint action taken by all agents
     * @param jointReward - Shared reward
     * @returns Individual rewards for each agent
     */
    async multiAgentLearn(agentStates, jointAction, jointReward) {
        const individualRewards = new Map();
        // Distribute reward based on contribution (simplified)
        const numAgents = agentStates.size;
        const baseReward = jointReward / numAgents;
        for (const [agentId, state] of agentStates) {
            const action = jointAction.get(agentId) || 'default';
            // Calculate individual contribution
            const contribution = this.calculateContribution(agentId, state, action);
            const reward = baseReward * (0.5 + contribution * 0.5);
            individualRewards.set(agentId, reward);
            // Record for learning
            await this.recordTrajectory(agentId, [{
                    state,
                    action,
                    reward
                }]);
        }
        return individualRewards;
    }
    /**
     * Transfer learning: apply knowledge from source task to target task
     *
     * @param sourceAgent - Agent type to transfer from
     * @param targetAgent - Agent type to transfer to
     * @param transferRatio - How much knowledge to transfer (0-1)
     * @returns Success indicator
     */
    async transferLearning(sourceAgent, targetAgent, transferRatio = 0.7) {
        const sourcePatterns = await this.getPatterns(sourceAgent);
        if (sourcePatterns.length === 0) {
            return false;
        }
        // Transfer policy weights
        for (const [actionKey, weights] of this.policyWeights) {
            if (actionKey.startsWith(sourceAgent)) {
                const targetKey = actionKey.replace(sourceAgent, targetAgent);
                const targetWeights = this.policyWeights.get(targetKey) || [0];
                // Blend weights
                for (let i = 0; i < Math.min(weights.length, targetWeights.length); i++) {
                    targetWeights[i] = transferRatio * weights[i] + (1 - transferRatio) * targetWeights[i];
                }
                this.policyWeights.set(targetKey, targetWeights);
            }
        }
        // Transfer value estimates
        for (const [stateKey, value] of this.valueWeights) {
            const state = JSON.parse(stateKey);
            if (state.agentType === sourceAgent) {
                const targetState = { ...state, agentType: targetAgent };
                const targetKey = JSON.stringify(targetState);
                const targetValue = this.valueWeights.get(targetKey) || 0;
                this.valueWeights.set(targetKey, transferRatio * value + (1 - transferRatio) * targetValue);
            }
        }
        return true;
    }
    /**
     * Continuous learning: update model with new experience
     *
     * @param state - Current state
     * @param action - Action taken
     * @param reward - Reward received
     * @param nextState - Resulting state
     * @returns Updated value estimate
     */
    async continuousLearn(state, action, reward, nextState) {
        // Add to experience replay
        const tdError = Math.abs(reward - (this.valueWeights.get(JSON.stringify(state)) || 0));
        this.addExperience(state, action, reward, nextState, tdError + 1);
        // Update value function
        const value = await this.estimateValue(state, reward, nextState);
        // Update policy if we have enough experiences
        if (this.experienceBuffer.length >= this.replayConfig.batchSize) {
            const batch = this.sampleExperience();
            // Create mini-episode from batch
            const miniEpisode = {
                steps: batch.map(exp => ({
                    state: exp.state,
                    action: exp.action,
                    reward: exp.reward
                })),
                reward: batch.reduce((sum, exp) => sum + exp.reward, 0) / batch.length
            };
            await this.trainPolicy([miniEpisode]);
        }
        // Update metrics
        this.metrics.episodeReward += reward;
        this.metrics.avgReward = (this.metrics.avgReward * this.metrics.iterationCount + reward) / (this.metrics.iterationCount + 1);
        return value;
    }
    /**
     * Get current RL metrics
     */
    getRLMetrics() {
        return { ...this.metrics };
    }
    /**
     * Reset RL state (for new training session)
     */
    resetRL() {
        this.policyWeights.clear();
        this.valueWeights.clear();
        this.experienceBuffer = [];
        this.metrics = {
            episodeReward: 0,
            avgReward: 0,
            loss: 0,
            epsilon: this.policyConfig.epsilon,
            iterationCount: 0
        };
    }
    /**
     * Configure RL parameters
     */
    configureRL(config) {
        if (config.policy) {
            this.policyConfig = { ...this.policyConfig, ...config.policy };
        }
        if (config.value) {
            this.valueConfig = { ...this.valueConfig, ...config.value };
        }
        if (config.replay) {
            this.replayConfig = { ...this.replayConfig, ...config.replay };
        }
    }
    /**
     * Calculate agent contribution to joint reward (simplified)
     */
    calculateContribution(agentId, state, action) {
        // Simple heuristic: higher value states = higher contribution
        const stateKey = JSON.stringify(state);
        const stateValue = this.valueWeights.get(stateKey) || 0;
        // Normalize to [0, 1]
        return Math.max(0, Math.min(1, (stateValue + 1) / 2));
    }
}
//# sourceMappingURL=SonaTrajectoryService.js.map