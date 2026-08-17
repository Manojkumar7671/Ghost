export async function initPersistenceTables(pool) {
  if (!pool) return;
  try {
    // 1. Projects Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_projects (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        repo_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Persistence] ghost_projects table verified/created.');

    // 2. Memory Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_memories (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        project_id VARCHAR(255),
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Persistence] ghost_memories table verified/created.');

    // 3. RepositoryConnection Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_repo_connections (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        allowed_branch_policy VARCHAR(255) DEFAULT 'agent-*',
        status VARCHAR(100) DEFAULT 'inactive',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Persistence] ghost_repo_connections table verified/created.');

    // 4. AgentTask Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_agent_tasks (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        goal TEXT NOT NULL,
        repo_id VARCHAR(255) NOT NULL,
        status VARCHAR(100) DEFAULT 'draft',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        plan_summary TEXT,
        approval_state VARCHAR(100) DEFAULT 'pending',
        final_summary TEXT
      )
    `);
    console.log('[Persistence] ghost_agent_tasks table verified/created.');

    // 5. AgentRun Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_agent_runs (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        task_id VARCHAR(255) NOT NULL,
        branch_identifier VARCHAR(255),
        current_step VARCHAR(255),
        status VARCHAR(100) DEFAULT 'queued',
        cancel_reason TEXT,
        logs TEXT,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP
      )
    `);
    console.log('[Persistence] ghost_agent_runs table verified/created.');

    // 6. AgentArtifact Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_agent_artifacts (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        run_id VARCHAR(255) NOT NULL,
        diff_summary TEXT,
        changed_files TEXT,
        test_reports TEXT,
        command_output TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Persistence] ghost_agent_artifacts table verified/created.');

    // 7. Approval Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ghost_approvals (
        id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        action_class VARCHAR(255) NOT NULL,
        payload_hash VARCHAR(255) NOT NULL,
        decision VARCHAR(100) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Persistence] ghost_approvals table verified/created.');

  } catch (err) {
    console.error('[Persistence] Error initializing tables:', err.message);
  }
}
