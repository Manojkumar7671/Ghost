/**
 * ADR-060: Attestation Log
 *
 * Append-only audit log for every MutationProof and MutationDenial.
 * Backed by a better-sqlite3 (or sql.js) compatible database instance.
 *
 * The caller is responsible for opening the database and passing it in.
 * This class only creates the table schema if it does not exist yet.
 */
// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS mutation_attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  operation TEXT NOT NULL,
  proof_hash TEXT,
  agent_id TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL CHECK (status IN ('proved','denied')),
  denial_reason TEXT,
  denial_code TEXT,
  wasm_proof_id INTEGER,
  metadata TEXT
);
`;
const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_attestations_ts ON mutation_attestations(ts);
CREATE INDEX IF NOT EXISTS idx_attestations_agent ON mutation_attestations(agent_id);
CREATE INDEX IF NOT EXISTS idx_attestations_status ON mutation_attestations(status);
`;
// ---------------------------------------------------------------------------
// AttestationLog
// ---------------------------------------------------------------------------
export class AttestationLog {
    db;
    constructor(db) {
        this.db = db;
        try {
            this.db.exec(CREATE_TABLE_SQL);
            this.db.exec(CREATE_INDEXES_SQL);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`AttestationLog schema creation failed: ${msg}`);
        }
    }
    /**
     * Record a successful mutation proof.
     */
    record(proof) {
        const stmt = this.db.prepare(`
      INSERT INTO mutation_attestations
        (ts, operation, proof_hash, agent_id, namespace, status, wasm_proof_id, metadata)
      VALUES
        (?, ?, ?, ?, ?, 'proved', ?, ?)
    `);
        const ts = Math.floor(proof.timestamp / 1000);
        stmt.run(ts, proof.operation, proof.structuralHash, proof.attestation.agentId, proof.attestation.namespace, proof.wasmProofId ?? null, JSON.stringify({ invariantChecks: proof.invariantChecks }));
    }
    /**
     * Record a denied mutation.
     */
    recordDenial(denial, agentId, namespace) {
        const stmt = this.db.prepare(`
      INSERT INTO mutation_attestations
        (ts, operation, agent_id, namespace, status, denial_reason, denial_code, metadata)
      VALUES
        (?, ?, ?, ?, 'denied', ?, ?, ?)
    `);
        const ts = Math.floor(denial.timestamp / 1000);
        stmt.run(ts, denial.operation, agentId, namespace, denial.reason, denial.code, denial.field ? JSON.stringify({ field: denial.field }) : null);
    }
    /**
     * Query attestation records with optional filters.
     * All filters use parameterized queries to prevent injection.
     */
    query(opts = {}) {
        const conditions = [];
        const params = [];
        if (opts.agentId !== undefined) {
            conditions.push('agent_id = ?');
            params.push(opts.agentId);
        }
        if (opts.namespace !== undefined) {
            conditions.push('namespace = ?');
            params.push(opts.namespace);
        }
        if (opts.status !== undefined) {
            conditions.push('status = ?');
            params.push(opts.status);
        }
        if (opts.since !== undefined) {
            conditions.push('ts >= ?');
            params.push(Math.floor(opts.since / 1000));
        }
        const where = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';
        const limit = opts.limit !== undefined && opts.limit > 0
            ? `LIMIT ?`
            : '';
        if (limit) {
            params.push(opts.limit);
        }
        const sql = `SELECT * FROM mutation_attestations ${where} ORDER BY ts DESC ${limit}`;
        return this.db.prepare(sql).all(...params);
    }
    /**
     * Aggregate denial patterns grouped by denial_code.
     */
    getDenialPatterns(since) {
        let sql;
        const params = [];
        if (since !== undefined) {
            sql = `
        SELECT
          denial_code AS code,
          COUNT(*) AS count,
          MAX(ts) AS lastSeen
        FROM mutation_attestations
        WHERE status = 'denied' AND ts >= ?
        GROUP BY denial_code
        ORDER BY count DESC
      `;
            params.push(Math.floor(since / 1000));
        }
        else {
            sql = `
        SELECT
          denial_code AS code,
          COUNT(*) AS count,
          MAX(ts) AS lastSeen
        FROM mutation_attestations
        WHERE status = 'denied'
        GROUP BY denial_code
        ORDER BY count DESC
      `;
        }
        return this.db.prepare(sql).all(...params);
    }
    /**
     * Delete attestation records older than the given age in milliseconds.
     * Returns the number of deleted rows.
     */
    prune(olderThanMs) {
        const cutoffTs = Math.floor((Date.now() - olderThanMs) / 1000);
        const result = this.db.prepare('DELETE FROM mutation_attestations WHERE ts < ?').run(cutoffTs);
        return result.changes ?? 0;
    }
    /**
     * Summary statistics for the attestation log.
     */
    getStats() {
        const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'proved' THEN 1 ELSE 0 END) AS proved,
        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) AS denied,
        COUNT(DISTINCT agent_id) AS uniqueAgents,
        MIN(ts) AS oldestTs
      FROM mutation_attestations
    `).get();
        return {
            total: row?.total ?? 0,
            proved: row?.proved ?? 0,
            denied: row?.denied ?? 0,
            uniqueAgents: row?.uniqueAgents ?? 0,
            oldestTs: row?.oldestTs ?? 0,
        };
    }
}
//# sourceMappingURL=AttestationLog.js.map