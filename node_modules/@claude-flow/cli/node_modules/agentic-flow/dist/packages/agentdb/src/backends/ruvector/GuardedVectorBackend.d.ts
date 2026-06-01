/**
 * GuardedVectorBackend - Proof-Gated State Mutation (ADR-060)
 *
 * A drop-in replacement for RuVectorBackend that requires cryptographic
 * mutation proofs before allowing any state-changing operation. Read-only
 * operations pass through without proof.
 *
 * Architecture:
 * - Wraps any VectorBackend implementation
 * - MutationGuard validates and attests each mutation
 * - AttestationLog records all proof attempts for audit
 * - ProofDeniedError thrown when mutation is rejected
 *
 * Mutating operations (require proof):
 *   insert, insertBatch, search, remove, save, load
 *
 * Read-only operations (pass through):
 *   getStats, getLearning, setLearning, close
 */
import type { VectorBackend, SearchResult, SearchOptions, VectorStats } from '../VectorBackend.js';
import type { MutationDenial, AttestationToken } from '../../security/MutationGuard.js';
import { MutationGuard } from '../../security/MutationGuard.js';
import type { AttestationLog } from '../../security/AttestationLog.js';
/**
 * Error thrown when a mutation proof is denied by the guard.
 *
 * Contains the denial reason, error code, operation name,
 * and the full MutationDenial object for programmatic handling.
 */
export declare class ProofDeniedError extends Error {
    readonly code: string;
    readonly operation: string;
    readonly denial: MutationDenial;
    constructor(reason: string, code: string, operation: string, denial: MutationDenial);
}
/**
 * GuardedVectorBackend - VectorBackend wrapper with proof-gated mutations
 *
 * Every mutating method requires an optional AttestationToken. When provided,
 * the token is validated by MutationGuard before the operation proceeds.
 * If the proof is denied, a ProofDeniedError is thrown and the operation
 * is not forwarded to the inner backend.
 */
export declare class GuardedVectorBackend implements VectorBackend {
    readonly name: "ruvector";
    private readonly inner;
    private readonly guard;
    private readonly log?;
    constructor(inner: VectorBackend, guard: MutationGuard, log?: AttestationLog);
    private requireProof;
    private wrapBackendError;
    insert(id: string, embedding: Float32Array, metadata?: Record<string, any>, token?: AttestationToken): void;
    insertBatch(items: Array<{
        id: string;
        embedding: Float32Array;
        metadata?: Record<string, any>;
    }>, token?: AttestationToken): void;
    search(query: Float32Array, k: number, options?: SearchOptions, token?: AttestationToken): SearchResult[];
    remove(id: string, token?: AttestationToken): boolean;
    save(path: string, token?: AttestationToken): Promise<void>;
    load(path: string, token?: AttestationToken): Promise<void>;
    /**
     * Get backend statistics (read-only, no proof required).
     *
     * Merges inner backend stats with guard stats and optional log stats.
     */
    getStats(): VectorStats;
    /**
     * Get the learning instance from the inner backend (read-only, no proof required).
     */
    getLearning(): any;
    /**
     * Set the learning instance on the inner backend (pass-through, no proof required).
     */
    setLearning(learning: any): void;
    /**
     * Close and cleanup resources (pass-through, no proof required).
     */
    close(): void;
    /**
     * Get the underlying inner backend for direct access when needed.
     */
    getInner(): VectorBackend;
    /**
     * Get the mutation guard instance.
     */
    getGuard(): MutationGuard;
    /**
     * Get the attestation log instance, if configured.
     */
    getLog(): AttestationLog | undefined;
}
//# sourceMappingURL=GuardedVectorBackend.d.ts.map