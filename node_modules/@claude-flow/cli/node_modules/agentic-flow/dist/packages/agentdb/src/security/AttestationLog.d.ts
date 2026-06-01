/**
 * ADR-060: Attestation Log
 *
 * Append-only audit log for every MutationProof and MutationDenial.
 * Backed by a better-sqlite3 (or sql.js) compatible database instance.
 *
 * The caller is responsible for opening the database and passing it in.
 * This class only creates the table schema if it does not exist yet.
 */
import type { MutationProof, MutationDenial } from './MutationGuard.js';
export interface DatabaseLike {
    exec(sql: string): void;
    prepare(sql: string): {
        run(...params: unknown[]): {
            changes?: number;
        };
        all(...params: unknown[]): unknown[];
        get(...params: unknown[]): unknown;
    };
}
export interface AttestationQueryOptions {
    agentId?: string;
    namespace?: string;
    status?: 'proved' | 'denied';
    since?: number;
    limit?: number;
}
export interface DenialPattern {
    code: string;
    count: number;
    lastSeen: number;
}
export interface AttestationStats {
    total: number;
    proved: number;
    denied: number;
    uniqueAgents: number;
    oldestTs: number;
}
export declare class AttestationLog {
    private readonly db;
    constructor(db: DatabaseLike);
    /**
     * Record a successful mutation proof.
     */
    record(proof: MutationProof): void;
    /**
     * Record a denied mutation.
     */
    recordDenial(denial: MutationDenial, agentId: string, namespace: string): void;
    /**
     * Query attestation records with optional filters.
     * All filters use parameterized queries to prevent injection.
     */
    query(opts?: AttestationQueryOptions): any[];
    /**
     * Aggregate denial patterns grouped by denial_code.
     */
    getDenialPatterns(since?: number): DenialPattern[];
    /**
     * Delete attestation records older than the given age in milliseconds.
     * Returns the number of deleted rows.
     */
    prune(olderThanMs: number): number;
    /**
     * Summary statistics for the attestation log.
     */
    getStats(): AttestationStats;
}
//# sourceMappingURL=AttestationLog.d.ts.map