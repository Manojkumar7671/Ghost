import sys

with open('mini-swe-agent/src/minisweagent/objectives.py', 'r') as f:
    code = f.read()

code = code.replace(
    'c.execute("INSERT INTO standing_objectives VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",',
    'c.execute("INSERT INTO standing_objectives (id, owner, goal_text, status, created_at, last_run_at, run_count, check_interval_seconds, max_runs, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",'
)

with open('mini-swe-agent/src/minisweagent/objectives.py', 'w') as f:
    f.write(code)

with open('mini-swe-agent/src/minisweagent/scheduler.py', 'r') as f:
    code = f.read()

code = code.replace(
    'c.execute("INSERT INTO ghost_agent_schedules VALUES (?, ?, ?, ?, ?, ?, ?)",',
    'c.execute("INSERT INTO ghost_agent_schedules (schedule_id, goal, cron_expression, enabled, last_run_at, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",'
)

with open('mini-swe-agent/src/minisweagent/scheduler.py', 'w') as f:
    f.write(code)

print("Patched create scripts")
