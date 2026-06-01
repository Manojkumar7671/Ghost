/**
 * Backend Factory - Automatic Backend Detection and Selection
 *
 * Detects available vector backends and creates appropriate instances.
 * Priority: RuVector (native/WASM) > HNSWLib (Node.js)
 *
 * Features:
 * - Automatic detection of @ruvector packages
 * - Native vs WASM detection for RuVector
 * - GNN and Graph capabilities detection
 * - Graceful fallback to HNSWLib
 * - Clear error messages for missing dependencies
 */
import { RuVectorBackend } from './ruvector/RuVectorBackend.js';
import { HNSWLibBackend } from './hnswlib/HNSWLibBackend.js';
import { GuardedVectorBackend, ProofDeniedError } from './ruvector/GuardedVectorBackend.js';
import { MutationGuard } from '../security/MutationGuard.js';
import { AttestationLog } from '../security/AttestationLog.js';
/**
 * Detect available vector backends
 */
export async function detectBackends() {
    const result = {
        available: 'none',
        ruvector: {
            core: false,
            gnn: false,
            graph: false,
            native: false,
            graphTransformer: false,
        },
        hnswlib: false
    };
    // Check RuVector packages (main package or scoped packages)
    try {
        // Try main ruvector package first (v0.1.99+)
        const ruvector = await import('ruvector');
        result.ruvector.core = true;
        result.ruvector.gnn = true; // Main package includes GNN
        result.ruvector.graph = true; // Main package includes Graph
        // Check for native backend availability (0.1.99+ API)
        if (typeof ruvector.isNative === 'function') {
            result.ruvector.native = ruvector.isNative();
        }
        else if (typeof ruvector.backend === 'function') {
            // Legacy API check
            const backend = ruvector.backend();
            result.ruvector.native = backend === 'native' || backend === 'napi';
        }
        result.available = 'ruvector';
    }
    catch {
        // Try scoped packages as fallback
        try {
            const core = await import('@ruvector/core');
            result.ruvector.core = true;
            // Check for native backend (scoped packages)
            if (typeof core.isNative === 'function') {
                result.ruvector.native = core.isNative();
            }
            else if (typeof core.backend === 'function') {
                const backend = core.backend();
                result.ruvector.native = backend === 'native' || backend === 'napi';
            }
            result.available = 'ruvector';
            // Check optional packages
            try {
                await import('@ruvector/gnn');
                result.ruvector.gnn = true;
            }
            catch {
                // GNN not installed - this is optional
            }
            try {
                await import('@ruvector/graph-node');
                result.ruvector.graph = true;
            }
            catch {
                // Graph not installed - this is optional
            }
            try {
                await import('@ruvector/graph-transformer');
                result.ruvector.graphTransformer = true;
            }
            catch {
                // graph-transformer not installed - optional
            }
        }
        catch {
            // RuVector not installed - will try fallback
        }
    }
    // Check @ruvector/graph-transformer independently (may exist without core)
    if (!result.ruvector.graphTransformer) {
        try {
            await import('@ruvector/graph-transformer');
            result.ruvector.graphTransformer = true;
        }
        catch {
            // Try WASM version
            try {
                await import('ruvector-graph-transformer-wasm');
                result.ruvector.graphTransformer = true;
            }
            catch {
                // graph-transformer not installed in any form
            }
        }
    }
    // Check HNSWLib
    try {
        await import('hnswlib-node');
        result.hnswlib = true;
        if (result.available === 'none') {
            result.available = 'hnswlib';
        }
    }
    catch {
        // HNSWLib not installed
    }
    return result;
}
/**
 * Create vector backend with automatic detection
 *
 * @param type - Backend type: 'auto', 'ruvector', or 'hnswlib'
 * @param config - Vector configuration
 * @returns Initialized VectorBackend instance
 */
export async function createBackend(type, config) {
    const detection = await detectBackends();
    let backend;
    // Handle explicit backend selection
    if (type === 'ruvector') {
        if (!detection.ruvector.core) {
            throw new Error('RuVector not available.\n' +
                'Install with: npm install @ruvector/core\n' +
                'Optional GNN support: npm install @ruvector/gnn\n' +
                'Optional Graph support: npm install @ruvector/graph-node');
        }
        backend = new RuVectorBackend(config);
    }
    else if (type === 'hnswlib') {
        if (!detection.hnswlib) {
            throw new Error('HNSWLib not available.\n' +
                'Install with: npm install hnswlib-node');
        }
        backend = new HNSWLibBackend(config);
    }
    else {
        // Auto-detect best available backend
        if (detection.ruvector.core) {
            backend = new RuVectorBackend(config);
            const backendType = detection.ruvector.native ? 'native NAPI-RS' : 'WASM';
            const proofStatus = detection.ruvector.graphTransformer
                ? '+ graph-transformer proofs'
                : '(no proof engine)';
            console.log(`[AgentDB] Using RuVector backend (${backendType}) ${proofStatus}`);
            // Try to initialize RuVector, fallback to HNSWLib if it fails
            try {
                await backend.initialize();
                return backend;
            }
            catch (error) {
                const errorMessage = error.message;
                // If RuVector fails due to :memory: path or other initialization issues,
                // try falling back to HNSWLib
                if (detection.hnswlib) {
                    console.log('[AgentDB] RuVector initialization failed, falling back to HNSWLib');
                    console.log(`[AgentDB] Reason: ${errorMessage.split('\n')[0]}`);
                    backend = new HNSWLibBackend(config);
                    console.log('[AgentDB] Using HNSWLib backend (fallback)');
                }
                else {
                    // No fallback available, re-throw error
                    throw error;
                }
            }
        }
        else if (detection.hnswlib) {
            backend = new HNSWLibBackend(config);
            console.log('[AgentDB] Using HNSWLib backend (fallback)');
        }
        else {
            throw new Error('No vector backend available.\n' +
                'Install one of:\n' +
                '  - npm install ruvector@0.1.99+ (recommended, includes native NAPI-RS)\n' +
                '  - npm install @ruvector/core (alternative)\n' +
                '  - npm install hnswlib-node (fallback)');
        }
    }
    // Initialize the backend (if not already initialized)
    // Note: RuVector may already be initialized in the try block above
    try {
        await backend.initialize();
    }
    catch (error) {
        // Ignore if already initialized
        if (!error.message.includes('already initialized')) {
            throw error;
        }
    }
    return backend;
}
/**
 * Get recommended backend type based on environment
 */
export async function getRecommendedBackend() {
    const detection = await detectBackends();
    if (detection.ruvector.core) {
        return 'ruvector';
    }
    else if (detection.hnswlib) {
        return 'hnswlib';
    }
    else {
        return 'auto'; // Will throw error in createBackend
    }
}
/**
 * Check if a specific backend is available
 */
export async function isBackendAvailable(backend) {
    const detection = await detectBackends();
    if (backend === 'ruvector') {
        return detection.ruvector.core;
    }
    return detection.hnswlib;
}
/**
 * Get installation instructions for a backend
 */
export function getInstallCommand(backend) {
    return backend === 'ruvector'
        ? 'npm install ruvector'
        : 'npm install hnswlib-node';
}
// Re-export proof-gated types (ADR-060)
export { GuardedVectorBackend, ProofDeniedError };
/**
 * Create a proof-gated vector backend (ADR-060)
 *
 * Wraps a standard VectorBackend with MutationGuard to require
 * cryptographic proofs for all mutating operations. Optionally
 * attaches an AttestationLog when a database handle is provided.
 *
 * @param type - Backend type: 'auto', 'ruvector', or 'hnswlib'
 * @param config - Vector configuration with optional database handle
 * @returns Object containing the guarded backend, guard, and optional log
 */
export async function createGuardedBackend(type, config) {
    const detection = await detectBackends();
    const inner = await createBackend(type, config);
    // Enable proofs if graph-transformer is available or explicitly requested
    const enableWasmProofs = config.enableProofs ?? detection.ruvector.graphTransformer ?? true;
    const guard = new MutationGuard({
        dimension: config.dimension ?? config.dimensions ?? 384,
        maxElements: config.maxElements ?? 10000,
        enableWasmProofs,
        enableAttestationLog: true,
        defaultNamespace: 'default',
    });
    await guard.initialize();
    // Log the proof engine status
    const stats = guard.getStats();
    console.log(`[GuardedBackend] Proof engine: ${stats.engineType}, WASM available: ${stats.wasmAvailable}`);
    let log = null;
    if (config.database) {
        log = new AttestationLog(config.database);
    }
    return { backend: new GuardedVectorBackend(inner, guard, log ?? undefined), guard, log };
}
//# sourceMappingURL=factory.js.map