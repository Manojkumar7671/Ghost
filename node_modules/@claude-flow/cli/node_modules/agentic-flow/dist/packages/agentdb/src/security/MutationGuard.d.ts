/**
 * ADR-060: Proof-Gated State Mutation
 *
 * MutationGuard is the single validation gate between controllers and backends.
 * Every mutation must produce a MutationProof before the backend executes it.
 * If validation fails a MutationDenial is returned instead.
 * Optional WASM-accelerated proofs via @ruvnet/ruvector-verified-wasm.
 */
export interface MutationProof {
    id: string;
    operation: 'insert' | 'search' | 'remove' | 'batch_insert' | 'save' | 'load';
    timestamp: number;
    structuralHash: string;
    attestation: AttestationToken;
    invariantChecks: InvariantResult[];
    wasmProofId?: number;
    valid: true;
}
export interface AttestationToken {
    agentId: string;
    namespace: string;
    scope: 'read' | 'write' | 'admin';
    issuedAt: number;
    expiresAt: number;
}
export interface InvariantResult {
    check: string;
    passed: boolean;
}
export interface MutationDenial {
    operation: string;
    reason: string;
    code: string;
    field?: string;
    timestamp: number;
}
export interface GuardConfig {
    dimension: number;
    maxElements: number;
    enableWasmProofs: boolean;
    enableAttestationLog: boolean;
    defaultNamespace: string;
}
export declare class MutationGuard {
    private readonly config;
    private vectorCount;
    private wasmEnv;
    private wasmAvailable;
    private engineType;
    private nextWasmProofId;
    private proofsIssuedCount;
    private denialsCount;
    private proofTimesNs;
    constructor(config: GuardConfig);
    initialize(): Promise<void>;
    private validateToken;
    proveInsert(id: string, embedding: Float32Array, metadata?: Record<string, any>, token?: AttestationToken): MutationProof | MutationDenial;
    proveSearch(query: Float32Array, k: number, options?: any, token?: AttestationToken): MutationProof | MutationDenial;
    proveBatchInsert(items: Array<{
        id: string;
        embedding: Float32Array;
        metadata?: Record<string, any>;
    }>, token?: AttestationToken): MutationProof | MutationDenial;
    proveRemove(id: string, token?: AttestationToken): MutationProof | MutationDenial;
    proveSave(path: string, token?: AttestationToken): MutationProof | MutationDenial;
    proveLoad(path: string, token?: AttestationToken): MutationProof | MutationDenial;
    createToken(agentId: string, namespace: string, scope: 'read' | 'write' | 'admin', ttlMs?: number): AttestationToken;
    getStats(): {
        proofsIssued: number;
        denials: number;
        wasmAvailable: boolean;
        engineType: string;
        avgProofTimeNs: number;
    };
    static isDenial(result: MutationProof | MutationDenial): result is MutationDenial;
    getVectorCount(): number;
    setVectorCount(count: number): void;
    private buildProof;
    private validateSafePath;
    private hrtimeNs;
    private recordProofTime;
}
//# sourceMappingURL=MutationGuard.d.ts.map