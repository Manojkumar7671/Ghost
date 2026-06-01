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
import type { VectorBackend, VectorConfig } from './VectorBackend.js';
import { GuardedVectorBackend, ProofDeniedError } from './ruvector/GuardedVectorBackend.js';
import { MutationGuard } from '../security/MutationGuard.js';
import { AttestationLog } from '../security/AttestationLog.js';
export type BackendType = 'auto' | 'ruvector' | 'hnswlib';
export interface BackendDetection {
    available: 'ruvector' | 'hnswlib' | 'none';
    ruvector: {
        core: boolean;
        gnn: boolean;
        graph: boolean;
        native: boolean;
        graphTransformer: boolean;
    };
    hnswlib: boolean;
}
/**
 * Detect available vector backends
 */
export declare function detectBackends(): Promise<BackendDetection>;
/**
 * Create vector backend with automatic detection
 *
 * @param type - Backend type: 'auto', 'ruvector', or 'hnswlib'
 * @param config - Vector configuration
 * @returns Initialized VectorBackend instance
 */
export declare function createBackend(type: BackendType, config: VectorConfig): Promise<VectorBackend>;
/**
 * Get recommended backend type based on environment
 */
export declare function getRecommendedBackend(): Promise<BackendType>;
/**
 * Check if a specific backend is available
 */
export declare function isBackendAvailable(backend: 'ruvector' | 'hnswlib'): Promise<boolean>;
/**
 * Get installation instructions for a backend
 */
export declare function getInstallCommand(backend: 'ruvector' | 'hnswlib'): string;
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
export declare function createGuardedBackend(type: BackendType, config: VectorConfig & {
    database?: any;
    enableProofs?: boolean;
}): Promise<{
    backend: GuardedVectorBackend;
    guard: MutationGuard;
    log: AttestationLog | null;
}>;
//# sourceMappingURL=factory.d.ts.map