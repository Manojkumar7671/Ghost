import sqlite3

conn = sqlite3.connect('mini-swe-agent/ghost_agent_runs.db')
c = conn.cursor()

c.execute("CREATE TABLE IF NOT EXISTS daemon_status (id TEXT PRIMARY KEY, last_heartbeat REAL)")
c.execute("INSERT OR IGNORE INTO daemon_status (id, last_heartbeat) VALUES ('daemon1', 0)")

for table in ['ghost_agent_schedules', 'standing_objectives']:
    try:
        c.execute(f"ALTER TABLE {table} ADD COLUMN locked_at REAL")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute(f"ALTER TABLE {table} ADD COLUMN locked_by TEXT")
    except sqlite3.OperationalError:
        pass

conn.commit()
conn.close()
print("Migrated locks")
