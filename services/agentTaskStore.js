import crypto from 'crypto';
import { validatePlan, hashPlan } from './agentPolicy.js';

class AgentTaskStore {
  constructor(pool) {
    this.pool = pool;
  }

  async initTables() {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    try {
      // 1. Repo Profiles
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ghost_agent_repo_profiles (
          id VARCHAR(255) PRIMARY KEY,
          owner_id VARCHAR(255) NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          local_identifier VARCHAR(255) NOT NULL,
          allowed_branch_prefix VARCHAR(255) DEFAULT 'agent-',
          permitted_paths JSONB,
          test_command_allowlist JSONB,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 2. Tasks
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ghost_agent_tasks (
          id VARCHAR(255) PRIMARY KEY,
          owner_id VARCHAR(255),
          goal TEXT,
          repo_profile_id VARCHAR(255),
          route VARCHAR(50),
          plan_json JSONB,
          plan_hash VARCHAR(255),
          approved_scope_json JSONB,
          status VARCHAR(100) DEFAULT 'draft',
          deadline_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          cancellation_version INT DEFAULT 0
        )
      `);

      // 3. Worker Devices
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ghost_worker_devices (
          id VARCHAR(255) PRIMARY KEY,
          owner_id VARCHAR(255) NOT NULL,
          public_label VARCHAR(255),
          token_hash VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'idle',
          protocol_version VARCHAR(50),
          last_heartbeat TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 4. Worker Leases
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ghost_worker_leases (
          id VARCHAR(255) PRIMARY KEY,
          task_id VARCHAR(255) NOT NULL,
          device_id VARCHAR(255) NOT NULL,
          lease_token_hash VARCHAR(255) NOT NULL,
          issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expiry_at TIMESTAMP NOT NULL,
          claim_status VARCHAR(50) DEFAULT 'active',
          cancellation_version INT NOT NULL
        )
      `);

      // 5. Execution Events
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ghost_task_events (
          id SERIAL PRIMARY KEY,
          task_id VARCHAR(255) NOT NULL,
          actor_kind VARCHAR(50) NOT NULL,
          event_name VARCHAR(100) NOT NULL,
          data_json JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 6. Final Execution Artifacts
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ghost_task_artifacts (
          id VARCHAR(255) PRIMARY KEY,
          task_id VARCHAR(255) NOT NULL,
          changed_file_manifest JSONB,
          diff_summary TEXT,
          diff_hash VARCHAR(255),
          test_command JSONB,
          exit_code INT,
          output_redacted TEXT,
          final_status VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e) {
      console.error("Failed to initialize Ghost Task Store tables:", e);
      throw e;
    }
  }

  generateId() {
    return crypto.randomUUID();
  }

  // --- REPO PROFILES ---
  async createRepoProfile(profile) {
    if (!this.pool) return profile;
    const { id = this.generateId(), owner_id, display_name, local_identifier, permitted_paths, test_command_allowlist } = profile;
    await this.pool.query(
      `INSERT INTO ghost_agent_repo_profiles (id, owner_id, display_name, local_identifier, permitted_paths, test_command_allowlist)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, owner_id, display_name, local_identifier, JSON.stringify(permitted_paths), JSON.stringify(test_command_allowlist)]
    );
    return { ...profile, id };
  }

  async getRepoProfile(id) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const res = await this.pool.query(`SELECT * FROM ghost_agent_repo_profiles WHERE id = $1`, [id]);
    return res.rows[0];
  }

  // --- TASKS ---
  async createTask(ownerId, goal, repoProfileId) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    
    const profileRes = await this.pool.query(
      `SELECT owner_id FROM ghost_agent_repo_profiles WHERE id = $1`, [repoProfileId]
    );
    if (profileRes.rowCount === 0) throw new Error("Repo profile not found");
    if (profileRes.rows[0].owner_id !== ownerId) throw new Error("Unauthorized: Repo profile belongs to a different owner");
    
    const taskId = this.generateId();
    const cleanGoal = this.redactSecrets(goal);
    await this.pool.query(
      `INSERT INTO ghost_agent_tasks (id, owner_id, goal, repo_profile_id, status) VALUES ($1, $2, $3, $4, 'draft')`,
      [taskId, ownerId, cleanGoal, repoProfileId]
    );
    await this.recordEvent(taskId, 'owner', 'created', { goal: cleanGoal, repoProfileId });
    return taskId;
  }

  async getTask(taskId) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const res = await this.pool.query(`SELECT * FROM ghost_agent_tasks WHERE id = $1`, [taskId]);
    return res.rows[0];
  }

  async updateTaskPlan(taskId, ownerId, planJson) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    
    // Check ownership and repoProfileId
    const taskRes = await this.pool.query(`SELECT repo_profile_id FROM ghost_agent_tasks WHERE id = $1 AND owner_id = $2`, [taskId, ownerId]);
    if (taskRes.rowCount === 0) throw new Error("Task not found");
    if (taskRes.rows[0].repo_profile_id !== planJson.repoProfileId) throw new Error("Repo profile mismatch in plan");
    const planStr = JSON.stringify(planJson);
    const cleanPlanStr = JSON.stringify(this.redactSecrets(planJson));
    if (planStr !== cleanPlanStr) {
      throw new Error("Plan contains unsafe secret values and was rejected");
    }
    
    const normalizedPlan = validatePlan(planJson);
    const actualHash = hashPlan(normalizedPlan);

    const res = await this.pool.query(
      `UPDATE ghost_agent_tasks SET plan_json = $1, plan_hash = $2, deadline_at = $3, status = 'planned' 
       WHERE id = $4 AND owner_id = $5 AND status IN ('draft', 'planned') RETURNING id`,
      [JSON.stringify(normalizedPlan), actualHash, new Date(normalizedPlan.deadline).toISOString(), taskId, ownerId]
    );
    if (res.rowCount === 0) throw new Error("Task not found or not in draft/planned state");
    await this.recordEvent(taskId, 'owner', 'planned', { planHash: actualHash });
  }

  async requestApproval(taskId, ownerId) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const res = await this.pool.query(
      `UPDATE ghost_agent_tasks SET status = 'awaiting_approval' 
       WHERE id = $1 AND owner_id = $2 AND status = 'planned' RETURNING id`,
      [taskId, ownerId]
    );
    if (res.rowCount === 0) throw new Error("Task not found or not in planned state");
    await this.recordEvent(taskId, 'owner', 'approval_requested', {});
  }

  async approveTask(taskId, ownerId, expectedPlanHash, route) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    
    // Read stored validated plan
    const taskRes = await this.pool.query(`SELECT plan_json, plan_hash FROM ghost_agent_tasks WHERE id = $1 AND owner_id = $2 AND status = 'awaiting_approval'`, [taskId, ownerId]);
    if (taskRes.rowCount === 0) throw new Error("Task not found or not in awaiting_approval state");
    const task = taskRes.rows[0];
    if (task.plan_hash !== expectedPlanHash) throw new Error("Approval failed: Hash mismatch");
    if (task.plan_json && task.plan_json.route !== route) throw new Error("Approval failed: Route mismatch");
    // We enforce exact plan hash match atomically
    const res = await this.pool.query(
      `UPDATE ghost_agent_tasks SET status = 'approved', route = $1, approved_scope_json = plan_json 
       WHERE id = $2 AND owner_id = $3 AND plan_hash = $4 AND status = 'awaiting_approval' RETURNING id`,
      [route, taskId, ownerId, expectedPlanHash]
    );
    if (res.rowCount === 0) throw new Error("Approval failed: Hash mismatch, bad state, or unauthorized");
    await this.recordEvent(taskId, 'owner', 'approved', { expectedPlanHash });
  }

  async cancelTask(taskId, ownerId) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE ghost_agent_tasks SET status = 'cancelled', cancellation_version = cancellation_version + 1
         WHERE id = $1 AND owner_id = $2 RETURNING cancellation_version`,
        [taskId, ownerId]
      );
      if (res.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error("Task not found or unauthorized");
      }
      const version = res.rows[0].cancellation_version;
      await this.recordEvent(taskId, 'owner', 'cancelled', { cancellationVersion: version }, client);
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // --- WORKER DEVICES ---
  async registerDevice(ownerId, publicLabel) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const deviceId = this.generateId();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    
    await this.pool.query(
      `INSERT INTO ghost_worker_devices (id, owner_id, public_label, token_hash) VALUES ($1, $2, $3, $4)`,
      [deviceId, ownerId, publicLabel, tokenHash]
    );
    return { deviceId, token: rawToken };
  }

  async verifyDeviceToken(deviceId, rawToken) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const res = await this.pool.query(
      `SELECT id FROM ghost_worker_devices WHERE id = $1 AND token_hash = $2`,
      [deviceId, hash]
    );
    return res.rowCount > 0;
  }

  async heartbeat(deviceId, protocolVersion) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    await this.pool.query(
      `UPDATE ghost_worker_devices SET last_heartbeat = CURRENT_TIMESTAMP, protocol_version = $1 WHERE id = $2`,
      [protocolVersion, deviceId]
    );
  }

  // --- LEASES AND EXECUTION ---
  async claimApprovedTask(deviceId, route) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    // Find an approved task, update it to dispatched, create a lease atomically.
    // Use FOR UPDATE SKIP LOCKED to prevent race conditions.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const deviceRes = await client.query(`SELECT owner_id FROM ghost_worker_devices WHERE id = $1`, [deviceId]);
      if (deviceRes.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error("Device not found or unregistered");
      }
      const deviceOwnerId = deviceRes.rows[0].owner_id;

      const taskRes = await client.query(`
        SELECT id, plan_json, plan_hash, deadline_at, cancellation_version FROM ghost_agent_tasks 
        WHERE status = 'approved' AND route = $1 AND owner_id = $2 AND (deadline_at IS NULL OR deadline_at > CURRENT_TIMESTAMP)
        FOR UPDATE SKIP LOCKED LIMIT 1
      `, [route, deviceOwnerId]);

      if (taskRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      
      const task = taskRes.rows[0];
      const taskId = task.id;
      
      const rawLeaseToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawLeaseToken).digest('hex');
      const leaseId = this.generateId();
      
      // 1 hour lease expiry by default
      const expiry = new Date(Date.now() + 60 * 60 * 1000); 

      await client.query(
        `INSERT INTO ghost_worker_leases (id, task_id, device_id, lease_token_hash, expiry_at, cancellation_version)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leaseId, taskId, deviceId, tokenHash, expiry, task.cancellation_version]
      );

      await client.query(
        `UPDATE ghost_agent_tasks SET status = 'dispatched' WHERE id = $1`,
        [taskId]
      );

      await client.query(
        `INSERT INTO ghost_task_events (task_id, actor_kind, event_name, data_json) VALUES ($1, 'worker', 'dispatched', $2)`,
        [taskId, JSON.stringify(this.redactSecrets({ deviceId, leaseId }))]
      );

      await client.query('COMMIT');
      return { 
        taskId, 
        leaseId, 
        leaseToken: rawLeaseToken, 
        plan: task.plan_json, 
        planHash: task.plan_hash,
        cancellationVersion: task.cancellation_version
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async verifyLease(taskId, deviceId, rawLeaseToken) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const tokenHash = crypto.createHash('sha256').update(rawLeaseToken).digest('hex');
    const res = await this.pool.query(`
      SELECT l.id FROM ghost_worker_leases l
      JOIN ghost_agent_tasks t ON t.id = l.task_id
      WHERE l.task_id = $1 AND l.device_id = $2 AND l.lease_token_hash = $3
        AND l.expiry_at > CURRENT_TIMESTAMP AND l.claim_status = 'active'
        AND l.cancellation_version = t.cancellation_version
    `, [taskId, deviceId, tokenHash]);
    return res.rowCount > 0;
  }

  async updateTaskStateByWorker(taskId, deviceId, rawLeaseToken, newState, eventData) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokenHash = crypto.createHash('sha256').update(rawLeaseToken).digest('hex');
      
      const leaseRes = await client.query(`
        SELECT l.id, t.status, t.cancellation_version as task_cancel_v, l.cancellation_version as lease_cancel_v
        FROM ghost_worker_leases l
        JOIN ghost_agent_tasks t ON t.id = l.task_id
        WHERE l.task_id = $1 AND l.device_id = $2 AND l.lease_token_hash = $3
          AND l.expiry_at > CURRENT_TIMESTAMP AND l.claim_status = 'active'
        FOR UPDATE OF l, t
      `, [taskId, deviceId, tokenHash]);

      if (leaseRes.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error("Invalid, expired, or cancelled lease");
      }

      const row = leaseRes.rows[0];
      if (row.task_cancel_v !== row.lease_cancel_v) {
        await client.query('ROLLBACK');
        throw new Error("Invalid, expired, or cancelled lease");
      }

      const validTransitions = {
        'running': ['dispatched'],
        'verifying': ['running'],
        'awaiting_review': ['verifying'],
        'failed': ['dispatched', 'running', 'verifying']
      };
      
      if (!validTransitions[newState]) {
        await client.query('ROLLBACK');
        throw new Error("Worker cannot transition to state: " + newState);
      }
      if (!validTransitions[newState].includes(row.status)) {
        await client.query('ROLLBACK');
        throw new Error("Invalid state transition or task not found");
      }

      await client.query(
        `UPDATE ghost_agent_tasks SET status = $1 WHERE id = $2`,
        [newState, taskId]
      );
      await this.recordEvent(taskId, 'worker', newState, eventData, client);
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async saveArtifact(taskId, deviceId, rawLeaseToken, artifactData) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokenHash = crypto.createHash('sha256').update(rawLeaseToken).digest('hex');
      
      const leaseRes = await client.query(`
        SELECT l.id, t.plan_json, t.cancellation_version as task_cancel_v, l.cancellation_version as lease_cancel_v
        FROM ghost_worker_leases l
        JOIN ghost_agent_tasks t ON t.id = l.task_id
        WHERE l.task_id = $1 AND l.device_id = $2 AND l.lease_token_hash = $3
          AND l.expiry_at > CURRENT_TIMESTAMP AND l.claim_status = 'active'
        FOR UPDATE OF l, t
      `, [taskId, deviceId, tokenHash]);

      if (leaseRes.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error("Invalid, expired, or cancelled lease");
      }

      const row = leaseRes.rows[0];
      if (row.task_cancel_v !== row.lease_cancel_v) {
        await client.query('ROLLBACK');
        throw new Error("Invalid, expired, or cancelled lease");
      }

      const plan = row.plan_json;
      if (
        !artifactData.testCommand ||
        !plan.testCommand ||
        artifactData.testCommand.executable !== plan.testCommand.executable ||
        JSON.stringify(artifactData.testCommand.args) !== JSON.stringify(plan.testCommand.args)
      ) {
        await client.query('ROLLBACK');
        throw new Error("Artifact test command does not match approved plan");
      }

      const checkPaths = (val) => {
        if (typeof val === 'string') {
          if (val.includes('..') || val.startsWith('/')) return false;
          return plan.allowedPaths.some(p => val === p || val.startsWith(p + '/'));
        }
        if (Array.isArray(val)) return val.every(checkPaths);
        if (typeof val === 'object' && val !== null) return Object.values(val).every(checkPaths);
        return true;
      };

      if (!checkPaths(artifactData.manifest)) {
        await client.query('ROLLBACK');
        throw new Error("Artifact manifest contains out-of-scope paths or traversal");
      }

      const artifactId = this.generateId();
      await client.query(`
        INSERT INTO ghost_task_artifacts (id, task_id, changed_file_manifest, diff_summary, diff_hash, test_command, exit_code, output_redacted, final_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        artifactId, taskId, 
        JSON.stringify(this.redactSecrets(artifactData.manifest)), this.redactSecrets(artifactData.diffSummary), artifactData.diffHash,
        JSON.stringify(this.redactSecrets(artifactData.testCommand)), artifactData.exitCode, this.redactSecrets(artifactData.outputRedacted), artifactData.status
      ]);
      await client.query('COMMIT');
      return artifactId;
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // --- OWNER REVIEWS ---
  async acceptTask(taskId, ownerId) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    
    // Validate that evidence exists and we are awaiting review
    const check = await this.pool.query(
      `SELECT t.status, 
        (SELECT COUNT(*) FROM ghost_task_artifacts a 
         WHERE a.task_id = t.id 
           AND a.exit_code = 0 
           AND a.diff_hash IS NOT NULL AND a.diff_hash != ''
           AND a.final_status = 'success'
        ) as valid_artifact_count 
       FROM ghost_agent_tasks t WHERE t.id = $1 AND t.owner_id = $2`,
      [taskId, ownerId]
    );
    if (check.rowCount === 0) throw new Error("Task not found");
    const { status, valid_artifact_count } = check.rows[0];
    
    if (status !== 'awaiting_review') throw new Error("Task is not awaiting review");
    if (parseInt(valid_artifact_count) === 0) throw new Error("No verified successful execution evidence exists");

    await this.pool.query(
      `UPDATE ghost_agent_tasks SET status = 'accepted' WHERE id = $1`,
      [taskId]
    );
    await this.recordEvent(taskId, 'owner', 'accepted', {});
  }

  async rejectTask(taskId, ownerId, reason) {
    if (!this.pool) throw new Error("Database connection pool is unavailable");
    const res = await this.pool.query(
      `UPDATE ghost_agent_tasks SET status = 'rejected' WHERE id = $1 AND owner_id = $2 AND status = 'awaiting_review'`,
      [taskId, ownerId]
    );
    if (res.rowCount === 0) throw new Error("Task not found or not in review");
    await this.recordEvent(taskId, 'owner', 'rejected', { reason });
  }

  redactSecrets(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      let redacted = obj;
      redacted = redacted.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@.+)/gi, '$1[REDACTED]$3');
      redacted = redacted.replace(/(Bearer\s+)([A-Za-z0-9\-\._~\+\/]+=*)/gi, '$1[REDACTED]');
      redacted = redacted.replace(/((?:api[_\-]?key|secret|token|password)\s*[=:]\s*)(["']?)([^"'\s&]+)(["']?)/gi, '$1$2[REDACTED]$4');
      redacted = redacted.replace(/(sk_(?:live|test)_[a-zA-Z0-9]+)/g, '[REDACTED]');
      redacted = redacted.replace(/TEST_SECRET_DO_NOT_LOG/g, '[REDACTED]');
      return redacted;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSecrets(item));
    }
    if (typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (/api[_\-]?key|secret|token|password/i.test(key) && typeof value === 'string') {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redactSecrets(value);
        }
      }
      return result;
    }
    return obj;
  }

  async recordEvent(taskId, actorKind, eventName, data, client = this.pool) {
    if (!client) throw new Error("Database connection pool is unavailable");
    const cleanData = this.redactSecrets(data || {});
    await client.query(
      `INSERT INTO ghost_task_events (task_id, actor_kind, event_name, data_json) VALUES ($1, $2, $3, $4)`,
      [taskId, actorKind, eventName, JSON.stringify(cleanData)]
    );
  }
}

export { AgentTaskStore };
