/**
 * LLM Router Service - Multi-Provider LLM Integration
 *
 * Uses agentic-flow's router SDK to support:
 * - OpenRouter (99% cost savings, 200+ models)
 * - Google Gemini (free tier available)
 * - Anthropic Claude (highest quality)
 *
 * Automatically selects optimal provider based on:
 * - Cost constraints
 * - Quality requirements
 * - Speed requirements
 * - Privacy requirements (local models via ONNX)
 */
export interface LLMConfig {
    provider?: 'openrouter' | 'gemini' | 'anthropic' | 'onnx';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
    priority?: 'quality' | 'balanced' | 'cost' | 'speed' | 'privacy';
}
export interface LLMResponse {
    content: string;
    tokensUsed: number;
    cost: number;
    provider: string;
    model: string;
    latencyMs: number;
}
export declare class LLMRouter {
    private config;
    private envLoaded;
    constructor(config?: LLMConfig);
    /**
     * Load environment variables using dotenv
     */
    private loadEnv;
    /**
     * Select default provider based on available API keys
     */
    private selectDefaultProvider;
    /**
     * Select default model for provider
     */
    private selectDefaultModel;
    /**
     * Get API key for provider from environment
     */
    private getApiKey;
    /**
     * Generate completion using configured provider
     */
    generate(prompt: string, options?: Partial<LLMConfig>): Promise<LLMResponse>;
    /**
     * Call OpenRouter API
     */
    private callOpenRouter;
    /**
     * Call Google Gemini API
     */
    private callGemini;
    /**
     * Call Anthropic API
     */
    private callAnthropic;
    /**
     * Generate local fallback response (simple template-based)
     */
    private generateLocalFallback;
    /**
     * Optimize model selection based on task priority
     */
    optimizeModelSelection(taskDescription: string, priority: 'quality' | 'balanced' | 'cost' | 'speed' | 'privacy'): LLMConfig;
    /**
     * Get current configuration
     */
    getConfig(): Required<LLMConfig>;
    /**
     * Check if provider is available (has API key)
     */
    isProviderAvailable(provider: 'openrouter' | 'gemini' | 'anthropic' | 'onnx'): boolean;
}
//# sourceMappingURL=LLMRouter.d.ts.map