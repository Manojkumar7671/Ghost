import sqlite3
import datetime
import json
import sys
import os
import uuid

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'ghost_agent_runs.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS pending_approvals
                 (approval_id TEXT PRIMARY KEY, task_id TEXT, step_id TEXT, tool_name TEXT, args TEXT, tier TEXT, status TEXT, created_at REAL, resolved_at REAL)''')
    conn.commit()
    conn.close()

def request_approval(task_id, step_id, tool_name, args_json, tier):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    approval_id = "appr-" + str(uuid.uuid4())
    now = datetime.datetime.now().timestamp()
    c.execute("INSERT INTO pending_approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              (approval_id, task_id, step_id, tool_name, args_json, tier, "PENDING", now, 0.0))
    conn.commit()
    conn.close()
    return approval_id

def check_approval(approval_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT status FROM pending_approvals WHERE approval_id = ?", (approval_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else "NOT_FOUND"

def resolve_approval(approval_id, resolution):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.datetime.now().timestamp()
    c.execute("UPDATE pending_approvals SET status = ?, resolved_at = ? WHERE approval_id = ?", (resolution, now, approval_id))
    conn.commit()
    conn.close()
    return {"ok": True, "status": resolution}

def list_pending():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT approval_id, task_id, step_id, tool_name, args, tier, status, created_at FROM pending_approvals WHERE status = 'PENDING'")
    rows = c.fetchall()
    conn.close()
    res = []
    for r in rows:
        res.append({
            "approval_id": r[0], "task_id": r[1], "step_id": r[2], 
            "tool_name": r[3], "args": json.loads(r[4]), "tier": r[5], 
            "status": r[6], "created_at": r[7]
        })
    return res

if __name__ == "__main__":
    init_db()
    if len(sys.argv) < 2:
        sys.exit(0)
    cmd = sys.argv[1]
    if cmd == "request":
        print(request_approval(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6]))
    elif cmd == "check":
        print(check_approval(sys.argv[2]))
    elif cmd == "resolve":
        print(json.dumps(resolve_approval(sys.argv[2], sys.argv[3])))
    elif cmd == "list":
        print(json.dumps(list_pending()))
