import sys
import json

with open("mini-swe-agent/src/minisweagent/pevr_service.py", "r") as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if "# Execution" in line:
        indent = line.split("#")[0]
        tiered_approval = f"""{indent}# Tiered Approval
{indent}tool_name = action["tool_name"]
{indent}TIERS = {{
{indent}    "read_file": "AUTO_ALLOW", "list_files": "AUTO_ALLOW", "run_tests": "AUTO_ALLOW",
{indent}    "github_lookup": "AUTO_ALLOW", "browser_read": "AUTO_ALLOW", "read_pdf": "AUTO_ALLOW",
{indent}    "write_file": "NOTIFY_THEN_WAIT", "edit_file": "NOTIFY_THEN_WAIT", "run_command": "NOTIFY_THEN_WAIT",
{indent}    "send_email": "HARD_GATE"
{indent}}}
{indent}tier_type = TIERS.get(tool_name, "HARD_GATE")
{indent}if tier_type != "AUTO_ALLOW":
{indent}    import approvals
{indent}    import time
{indent}    approval_id = approvals.request_approval(self.task_id, step["step_id"], tool_name, json.dumps(action["args"]), tier_type)
{indent}    timeout = 15 if tier_type == "NOTIFY_THEN_WAIT" else 300
{indent}    start_wait = time.time()
{indent}    final_status = "PENDING"
{indent}    while time.time() - start_wait < timeout:
{indent}        status = approvals.check_approval(approval_id)
{indent}        if status in ("APPROVED", "DENIED"):
{indent}            final_status = status
{indent}            break
{indent}        time.sleep(1)
{indent}    if final_status == "PENDING":
{indent}        if tier_type == "NOTIFY_THEN_WAIT":
{indent}            approvals.resolve_approval(approval_id, "AUTO_PROCEEDED")
{indent}            final_status = "AUTO_PROCEEDED"
{indent}            log_event(self.task_id, step["step_id"], "AUTO_PROCEEDED", tier, {{"tool_name": tool_name}})
{indent}        else:
{indent}            approvals.resolve_approval(approval_id, "DENIED")
{indent}            final_status = "DENIED"
{indent}    if final_status == "DENIED":
{indent}        log_event(self.task_id, step["step_id"], "DENIED", tier, {{"tool_name": tool_name}})
{indent}        return False
{indent}    if final_status == "APPROVED":
{indent}        log_event(self.task_id, step["step_id"], "APPROVED", tier, {{"tool_name": tool_name}})
"""
        new_lines.append(tiered_approval)
        new_lines.append(line)
    elif "exec_result = self.env.execute(action)" in line:
        indent = line.split("exec_result")[0]
        new_lines.append(indent + 'elif action["tool_name"] == "send_email":\n')
        new_lines.append(indent + '    exec_result = {"returncode": 0, "output": "Email sent"}\n')
        new_lines.append(indent + 'else:\n')
        new_lines.append(indent + '    exec_result = self.env.execute(action)\n')
    else:
        new_lines.append(line)

with open("mini-swe-agent/src/minisweagent/pevr_service.py", "w") as f:
    f.writelines(new_lines)
print("Injected tiered approval")
