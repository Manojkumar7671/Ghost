import sys

with open('mini-swe-agent/src/minisweagent/scheduler.py', 'r') as f:
    code = f.read()

# Replace the check_due function
old_func = """def check_due():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    import time
    now = time.time()
    c.execute("SELECT schedule_id, goal, cron_expression FROM ghost_agent_schedules WHERE enabled = 1 AND next_run_at <= ?", (now,))
    rows = c.fetchall()
    res = []
    for r in rows:
        sched_id = r[0]
        try:
            next_run = parse_cron(r[2])
            c.execute("UPDATE ghost_agent_schedules SET last_run_at = ?, next_run_at = ? WHERE schedule_id = ?", (now, next_run, sched_id))
            res.append({"schedule_id": r[0], "goal": r[1]})
        except ValueError:
            # Should not happen since we validated on create, but just in case
            pass
    conn.commit()
    conn.close()
    return res"""

new_func = """def check_due(daemon_id="daemon1"):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    import time
    now = time.time()
    
    # Try to lock rows
    c.execute("UPDATE ghost_agent_schedules SET locked_at = ?, locked_by = ? WHERE enabled = 1 AND next_run_at <= ? AND (locked_at IS NULL OR locked_at < ?)", (now, daemon_id, now, now - 300))
    conn.commit()
    
    # Fetch locked rows
    c.execute("SELECT schedule_id, goal, cron_expression FROM ghost_agent_schedules WHERE locked_by = ? AND locked_at = ?", (daemon_id, now))
    rows = c.fetchall()
    res = []
    for r in rows:
        sched_id = r[0]
        try:
            next_run = parse_cron(r[2])
            c.execute("UPDATE ghost_agent_schedules SET last_run_at = ?, next_run_at = ?, locked_at = NULL, locked_by = NULL WHERE schedule_id = ?", (now, next_run, sched_id))
            res.append({"schedule_id": r[0], "goal": r[1]})
        except ValueError:
            pass
    conn.commit()
    conn.close()
    return res"""

code = code.replace(old_func, new_func)

code = code.replace('elif cmd == "check":\n        print(json.dumps(check_due()))', 'elif cmd == "check":\n        daemon_id = sys.argv[2] if len(sys.argv) > 2 else "daemon1"\n        print(json.dumps(check_due(daemon_id)))')

with open('mini-swe-agent/src/minisweagent/scheduler.py', 'w') as f:
    f.write(code)

print("Patched scheduler.py")
