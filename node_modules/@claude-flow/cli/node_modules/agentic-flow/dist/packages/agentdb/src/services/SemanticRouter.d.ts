/**
 * SemanticRouter - Wraps @ruvector/router for semantic intent routing
 *
 * Provides semantic query routing to named intent routes using
 * @ruvector/router for embedding-based matching. Falls back to
 * keyword matching if @ruvector/router is not available.
 *
 * Usage:
 *   const router = new SemanticRouter();
 *   await router.initialize();
 *   await router.addRoute('search', 'Find information in memory', ['find', 'search', 'lookup']);
 *   await router.addRoute('store', 'Save information to memory', ['save', 'store', 'remember']);
 *   const { route, confidence } = await router.route('find me the latest results');
 */
export interface RouteResult {
    route: string;
    confidence: number;
}
export interface RouteConfig {
    embedding?: number[];
    keywords: string[];
}
export declare class SemanticRouter {
    private router;
    private available;
    private engineType;
    private routes;
    /**
     * Initialize the semantic router
     *
     * ADR-062 Phase 2: Tries native @ruvector/router (NAPI-RS) first,
     * falls back to keyword matching. Reports engine type for monitoring.
     *
     * @returns true if @ruvector/router was loaded, false if using fallback
     */
    initialize(): Promise<boolean>;
    /**
     * Get the active engine type: 'native' or 'js'
     */
    getEngineType(): string;
    /**
     * Add a named route with description and optional keywords
     *
     * When @ruvector/router is available, the description is used to
     * generate an embedding for semantic matching. Keywords are used
     * as fallback when the router is not available.
     *
     * @param name - Unique route identifier
     * @param description - Natural language description for semantic matching
     * @param keywords - Fallback keywords for simple matching
     */
    addRoute(name: string, description: string, keywords?: string[]): Promise<void>;
    /**
     * Route a query to the best matching route
     *
     * Uses semantic similarity via @ruvector/router when available,
     * otherwise falls back to keyword frequency matching.
     *
     * @param query - Natural language query to route
     * @returns Route name and confidence score (0-1)
     */
    route(query: string): Promise<RouteResult>;
    /**
     * Remove a route by name
     */
    removeRoute(name: string): boolean;
    /**
     * Get all registered route names
     */
    getRoutes(): string[];
    /**
     * Check if @ruvector/router is available
     */
    isAvailable(): boolean;
    /**
     * Keyword-based fallback routing
     *
     * Scores each route by the fraction of its keywords
     * that appear in the query string (case-insensitive).
     */
    private keywordMatch;
}
//# sourceMappingURL=SemanticRouter.d.ts.map