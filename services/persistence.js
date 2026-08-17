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
  } catch (err) {
    console.error('[Persistence] Error initializing tables:', err.message);
  }
}
