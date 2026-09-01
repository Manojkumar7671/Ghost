import sys

with open('mini-swe-agent/src/minisweagent/objectives.py', 'r') as f:
    code = f.read()

old_func = """def check_due():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    import time
    now = time.time()
    c.execute("SELECT * FROM standing_objectives WHERE status = 'ACTIVE' AND check_interval_seconds IS NOT NULL")
    rows = c.fetchall()
    cols = ['id', 'owner', 'goal_text', 'status', 'created_at', 'last_run_at', 'run_count', 'check_interval_seconds', 'max_runs', 'metadata']
    due = []
    for r in rows:
        obj = dict(zip(cols, r))
        # if max_runs is hit, auto-set DONE and skip
        if obj['max_runs'] is not None and obj['run_count'] >= obj['max_runs']:
            c.execute("UPDATE standing_objectives SET status = 'DONE' WHERE id = ?", (obj['id'],))
            continue
            
        if obj['last_run_at'] + obj['check_interval_seconds'] <= now:
            due.append(obj)
            # Update last_run_at immediately so we don't double fire
            c.execute("UPDATE standing_objectives SET last_run_at = ? WHERE id = ?", (now, obj['id']))
            
    conn.commit()
    conn.close()
    return due"""

new_func = """def check_due(daemon_id="daemon1"):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    import time
    now = time.time()
    
    # Pre-check for max_runs
    c.execute("UPDATE standing_objectives SET status = 'DONE' WHERE status = 'ACTIVE' AND max_runs IS NOT NULL AND run_count >= max_runs")
    
    c.execute("UPDATE standing_objectives SET locked_at = ?, locked_by = ? WHERE status = 'ACTIVE' AND check_interval_seconds IS NOT NULL AND last_run_at + check_interval_seconds <= ? AND (locked_at IS NULL OR locked_at < ?)", (now, daemon_id, now, now - 300))
    conn.commit()
    
    c.execute("SELECT * FROM standing_objectives WHERE locked_by = ? AND locked_at = ?", (daemon_id, now))
    rows = c.fetchall()
    cols = ['id', 'owner', 'goal_text', 'status', 'created_at', 'last_run_at', 'run_count', 'check_interval_seconds', 'max_runs', 'metadata']
    due = []
    for r in rows:
        obj = dict(zip(cols, r))
        due.append(obj)
        # We DO NOT clear the lock here because the run takes a while. 
        # But we DO update last_run_at so it doesn't immediately refire when lock expires if not intended.
        # Actually, let's clear the lock here and rely on last_run_at to prevent refiring.
        # Wait, the prompt says post_run updates last_run_at? No, check_due used to update last_run_at immediately.
        c.execute("UPDATE standing_objectives SET last_run_at = ?, locked_at = NULL, locked_by = NULL WHERE id = ?", (now, obj['id']))
    
    conn.commit()
    conn.close()
    return due"""

code = code.replace(old_func, new_func)

code = code.replace('elif cmd == "check":\n        print(json.dumps(check_due()))', 'elif cmd == "check":\n        daemon_id = sys.argv[2] if len(sys.argv) > 2 else "daemon1"\n        print(json.dumps(check_due(daemon_id)))')

with open('mini-swe-agent/src/minisweagent/objectives.py', 'w') as f:
    f.write(code)

print("Patched objectives.py")
