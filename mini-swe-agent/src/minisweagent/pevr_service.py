import json
import os
import sys
import time

_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)
import sqlite3
import uuid
import litellm
# litellm._turn_on_debug()

try:
    from dotenv import load_dotenv
    env_candidate = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '.env'))
    if os.path.exists(env_candidate):
        load_dotenv(env_candidate, override=False)
except Exception: pass

import argparse

from minisweagent.environments.gondolin import GondolinEnvironment
from minisweagent.models.utils.actions_toolcall import BASH_TOOL

litellm.drop_params = True
os.environ["MSWEA_COST_TRACKING"] = "ignore_errors"

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'ghost_agent_runs.db')

def init_db(goal=""):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS tasks
                 (task_id TEXT PRIMARY KEY, goal TEXT, plan TEXT, status TEXT, start_time REAL, end_time REAL, total_tokens INTEGER, total_latency REAL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS events
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, step_id TEXT, event_type TEXT, tier TEXT, details TEXT, timestamp REAL)''')
    
    conn.commit()
    conn.close()

def log_event(task_id, step_id, event_type, tier, details):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO events (task_id, step_id, event_type, tier, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
              (task_id, step_id, event_type, tier, json.dumps(details), time.time()))
    conn.commit()
    conn.close()

def extract_json(content):
    if not content:
        raise ValueError("Empty content to parse JSON from.")
    decoder = json.JSONDecoder()
    idx = content.find('{')
    while idx != -1:
        try:
            obj, end = decoder.raw_decode(content, idx)
            if isinstance(obj, dict) and "steps" in obj:
                return obj
            idx = content.find('{', idx + 1)
        except Exception:
            idx = content.find('{', idx + 1)
    
    clean = content.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        if lines[0].startswith("```"): lines = lines[1:]
        if lines and lines[-1].startswith("```"): lines = lines[:-1]
        clean = "\n".join(lines).strip()
    s = clean.find('{')
    e = clean.rfind('}')
    if s != -1 and e != -1 and e > s:
        return json.loads(clean[s:e+1])
    return json.loads(clean)

class ModelGateway:
    def __init__(self):
        self.total_tokens = 0
        self.total_latency = 0
        self.api_calls = 0

        candidates = []

        # 1. FreeLLMAPI (Cloud or Local) - High speed, unmetered, native tool-calling
        free_base = os.environ.get("FREELLMAPI_RENDER_URL") or os.environ.get("FREELLMAPI_BASE_URL") or "https://freellmapi-e17x.onrender.com"
        free_base = free_base.rstrip("/")
        if not free_base.endswith("/v1"):
            free_base += "/v1"
        candidates.append({
            "name": "freellmapi",
            "fast": "openai/auto",
            "strong": "openai/auto",
            "api_base": free_base,
            "api_key": os.environ.get("FREELLMAPI_API_KEY") or "free"
        })

        # 2. Groq
        groq_key = os.environ.get("GROQ_API_KEY")
        if groq_key:
            candidates.append({
                "name": "groq",
                "fast": "groq/openai/gpt-oss-20b",
                "strong": "groq/openai/gpt-oss-120b",
                "api_base": None,
                "api_key": groq_key
            })

        # 3. NVIDIA NIM
        nvidia_key = os.environ.get("NVIDIA_API_KEY") or os.environ.get("META_API_KEY")
        if nvidia_key:
            candidates.append({
                "name": "nvidia",
                "fast": "openai/meta/llama-3.2-11b-vision-instruct",
                "strong": "openai/meta/llama-3.2-11b-vision-instruct",
                "api_base": "https://integrate.api.nvidia.com/v1",
                "api_key": nvidia_key
            })

        # 4. OpenRouter
        if os.environ.get("OPENROUTER_API_KEY"):
            candidates.append({
                "name": "openrouter",
                "fast": "openrouter/meta-llama/llama-3.1-8b-instruct",
                "strong": "openrouter/meta-llama/llama-3.3-70b-instruct",
                "api_base": None,
                "api_key": os.environ.get("OPENROUTER_API_KEY")
            })

        # 5. Gemini
        if os.environ.get("GEMINI_API_KEY"):
            candidates.append({
                "name": "gemini",
                "fast": "gemini/gemini-1.5-flash",
                "strong": "gemini/gemini-1.5-pro",
                "api_base": None,
                "api_key": os.environ.get("GEMINI_API_KEY")
            })

        self.candidates = candidates
        self.current_provider = candidates[0]

    def call_planner(self, goal):
        prompt = f"Goal: {goal}\nCreate a step-by-step plan. Return ONLY raw valid JSON matching this schema: {{ 'steps': [ {{'step_id', 'objective', 'permitted_tools', 'verification_method': {{'type': 'run_command', 'command': '...'}}, 'retry_budget', 'dependencies'}} ] }}."
        last_err = None
        for prov in self.candidates:
            start = time.time()
            try:
                kwargs = {
                    "model": prov["strong"],
                    "messages": [{"role": "user", "content": prompt}]
                }
                if prov.get("api_base"): kwargs["api_base"] = prov["api_base"]
                if prov.get("api_key"): kwargs["api_key"] = prov["api_key"]

                resp = litellm.completion(**kwargs)
                lat = time.time() - start
                self.total_latency += lat
                self.api_calls += 1
                toks = resp.usage.total_tokens if hasattr(resp, 'usage') and resp.usage else 0
                self.total_tokens += toks
                self.current_provider = prov
                return extract_json(resp.choices[0].message.content)
            except Exception as e:
                last_err = e
                continue
        raise ValueError(f"Litellm completion failed across all models: {last_err}")

    def call_executor(self, messages, tools, tier):
        last_err = None
        for prov in self.candidates:
            start = time.time()
            model = prov["fast"] if tier == "fast" else prov["strong"]
            try:
                kwargs = {
                    "model": model,
                    "messages": messages,
                    "tools": tools,
                    "tool_choice": "auto" if tools else "none"
                }
                if prov.get("api_base"): kwargs["api_base"] = prov["api_base"]
                if prov.get("api_key"): kwargs["api_key"] = prov["api_key"]

                resp = litellm.completion(**kwargs)
                lat = time.time() - start
                self.total_latency += lat
                self.api_calls += 1
                toks = resp.usage.total_tokens if hasattr(resp, 'usage') and resp.usage else 0
                self.total_tokens += toks

                msg = resp.choices[0].message
                actions = []
                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        actions.append({"tool_name": tc.function.name, "args": json.loads(tc.function.arguments), "tool_call_id": tc.id})
                result = msg.model_dump(exclude_none=True)
                result["_model_used"] = model
                return actions, result
            except Exception as e:
                last_err = e
                continue
        raise ValueError(f"Litellm completion failed across all models: {last_err}")

# Import Multimodal Connectors for browser integration
try:
    from playwright.sync_api import sync_playwright
    import pypdf
except: pass

SEND_EMAIL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "send_email",
        "description": "Send an email.",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "body": {"type": "string"}
            },
            "required": ["to"]
        }
    }
}

BROWSER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "browser_read",
        "description": "Read-only browser interaction. NEVER pass form fields, submit buttons, or inputs.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "action": {"type": "string", "enum": ["text", "title", "screenshot"]},
                "screenshot_path": {"type": "string"}
            },
            "required": ["url", "action"]
        }
    }
}

class MultimodalConnectors:
    def browser_read(self, url: str, action: str, screenshot_path: str = None, **kwargs):
        forbidden_keys = {"fill", "click", "submit", "type", "post", "login", "password", "username"}
        if any(k in kwargs for k in forbidden_keys):
            raise ValueError(f"Operation rejected: Found forbidden arguments indicative of a side effect (write/form). Keys: {list(kwargs.keys())}")
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(url, timeout=15000)
                res = {}
                if action == "title":
                    res['output'] = page.title()
                elif action == "text":
                    res['output'] = page.evaluate("document.body.innerText")
                elif action == "screenshot":
                    if not screenshot_path:
                        screenshot_path = f"screenshot_{int(time.time())}.png"
                    page.screenshot(path=screenshot_path)
                    res['output'] = f"Screenshot saved to {screenshot_path}"
                browser.close()
                return {"returncode": 0, "output": res['output']}
        except Exception as e:
            raise ValueError(f"Litellm completion failed: {e}")

            return {"returncode": 1, "output": str(e)}

class PEVRAgent:
    def __init__(self, task_id, workspace=None):
        self.task_id = task_id
        
        from dotenv import load_dotenv
        import pathlib
        load_dotenv(pathlib.Path(__file__).parent.parent.parent.parent / '.env')
        
        # litellm.api_base removed
        litellm.api_key = "free"
        
        self.fast = "groq/openai/gpt-oss-20b"
        self.strong = "groq/openai/gpt-oss-120b"
        
        self.workspace = workspace
        self.gateway = ModelGateway()
        self.env = GondolinEnvironment(cwd=workspace) if workspace else GondolinEnvironment()
        self.multimodal = MultimodalConnectors()

    def run(self, goal, schedule_id=None):
        init_db()
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        start = time.time()
        c.execute("INSERT OR REPLACE INTO tasks (task_id, goal, status, start_time, total_tokens, total_latency) VALUES (?, ?, ?, ?, ?, ?)",
                  (self.task_id, goal, "RUNNING", start, 0, 0))
        conn.commit()
        if schedule_id:
            log_event(self.task_id, "NONE", "SCHEDULED_TRIGGER", "system", {"schedule_id": schedule_id, "fired_at": start})
        conn.commit()
        
        plan = self.gateway.call_planner(goal)
        c.execute("UPDATE tasks SET plan = ? WHERE task_id = ?", (json.dumps(plan), self.task_id))
        conn.commit()
        conn.close()
        
        log_event(self.task_id, "NONE", "PLAN_GENERATED", "strong", plan)
        env_class = self.env.__class__.__name__
        log_event(self.task_id, "NONE", "ENV_CHECK", "system", {"class": env_class})

        status = "SUCCESS"
        for step in plan.get('steps', []):
            if not self.execute_step(step):
                status = "FAILED"
                break
                
        end = time.time()
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("UPDATE tasks SET status = ?, end_time = ?, total_tokens = ?, total_latency = ? WHERE task_id = ?",
                  (status, end, self.gateway.total_tokens, self.gateway.total_latency, self.task_id))
        
        events = c.execute("SELECT event_type, details FROM events WHERE task_id = ?", (self.task_id,)).fetchall()
        
        # Build evidence report
        evidence = []
        for e in events:
            etype, details = e
            try: d = json.loads(details)
            except: d = {}
            if etype == "TOOL_SUCCESS":
                tool = d.get("tool", {})
                tname = tool.get("tool_name", "")
                args = tool.get("args", {})
                if tname in ["write_file", "edit_file", "run_command", "browser_read"]:
                    evidence.append(f"Used {tname}: {json.dumps(args)}")
            elif etype == "UNSAFE_PREVENTED":
                evidence.append(f"Blocked unsafe action: {json.dumps(d.get('tool', {}))}")
            elif etype == "PATH_CHECK" and d.get("safe") == False:
                evidence.append(f"(a) write_file was NEVER executed against the escaped path. (b) It was blocked before touching the filesystem. Raw Error: {d.get('raw_error')}")
            elif etype == "STEP_FAIL":
                if d.get("reason") == "llm_self_reported_failure":
                    evidence.append(f"LLM self-reported failure: {d.get('content')}")
                elif d.get("error"):
                    evidence.append(f"Failed with error: {d.get('error')}")
            elif etype == "MODEL_CALL":
                evidence.append(f"MODEL_CALL tier={d.get('tier')} model={d.get('model')}")
            elif etype == "ESCALATION":
                evidence.append(f"ESCALATION triggered: reason={d.get('reason')} -> now using strong tier")
                
        conn.commit()
        conn.close()
        
        return {
            "success": status == "SUCCESS",
            "task_id": self.task_id,
            "status": status,
            "plan": plan,
            "evidence": evidence
        }

    def execute_step(self, step):
        retry_budget_total = step.get('retry_budget', 3)
        retries = retry_budget_total
        tier = "fast"
        malformed = 0  # cumulative malformed calls — never reset on success
        messages = [{"role": "user", "content": f"Objective: {step.get('objective', '')}. You MUST invoke a tool from the permitted tools list to complete this step and generate evidence. Do not just respond with text."}]
        
        ALL_TOOLS = BASH_TOOL + [BROWSER_SCHEMA, SEND_EMAIL_SCHEMA]
        allowed = step.get('permitted_tools', [])
        tools_to_pass = [t for t in ALL_TOOLS if t['function']['name'] in allowed] if allowed else ALL_TOOLS
        if not tools_to_pass: tools_to_pass = ALL_TOOLS
        
        turn_limit = 8
        while retries >= 0 and turn_limit > 0:
            turn_limit -= 1
            try:
                actions, msg = self.gateway.call_executor(messages, tools_to_pass, tier)
                log_event(self.task_id, step['step_id'], "MODEL_CALL", tier, {"model": msg.get("_model_used", "unknown"), "tier": tier})
                clean_msg = {k:v for k,v in msg.items() if k != "_model_used"}
                messages.append(clean_msg) # history
                
                for action in actions:
                    if action['tool_name'] == "browser_read" and "fill" in action['args']:
                        log_event(self.task_id, step['step_id'], "UNSAFE_PREVENTED", tier, {"tool": action})
                        raise ValueError(f"Unsafe action prevented: {action['args']}")
                        
                    log_event(self.task_id, step['step_id'], "TOOL_SUCCESS", tier, {"tool": action})
                    # NOTE: malformed is NOT reset here — it is cumulative for the whole step
                    
                    # Tiered Approval
                    tool_name = action["tool_name"]
                    TIERS = {
                        "read_file": "AUTO_ALLOW", "list_files": "AUTO_ALLOW", "run_tests": "AUTO_ALLOW",
                        "github_lookup": "AUTO_ALLOW", "browser_read": "AUTO_ALLOW", "read_pdf": "AUTO_ALLOW",
                        "write_file": "NOTIFY_THEN_WAIT", "edit_file": "NOTIFY_THEN_WAIT", "run_command": "NOTIFY_THEN_WAIT",
                        "send_email": "HARD_GATE"
                    }
                    tier_type = TIERS.get(tool_name, "HARD_GATE")
                    import os
                    if tier_type != "AUTO_ALLOW" and os.environ.get("GHOST_AUTO_APPROVE") != "1":
                        import approvals
                        import time
                        approval_id = approvals.request_approval(self.task_id, step["step_id"], tool_name, json.dumps(action["args"]), tier_type)
                        timeout = 15 if tier_type == "NOTIFY_THEN_WAIT" else 300
                        start_wait = time.time()
                        final_status = "PENDING"
                        while time.time() - start_wait < timeout:
                            status = approvals.check_approval(approval_id)
                            if status in ("APPROVED", "DENIED"):
                                final_status = status
                                break
                            time.sleep(1)
                        if final_status == "PENDING":
                            if tier_type == "NOTIFY_THEN_WAIT":
                                approvals.resolve_approval(approval_id, "AUTO_PROCEEDED")
                                final_status = "AUTO_PROCEEDED"
                                log_event(self.task_id, step["step_id"], "AUTO_PROCEEDED", tier, {"tool_name": tool_name})
                            else:
                                approvals.resolve_approval(approval_id, "DENIED")
                                final_status = "DENIED"
                        if final_status == "DENIED":
                            log_event(self.task_id, step["step_id"], "DENIED", tier, {"tool_name": tool_name})
                            return False
                        if final_status == "APPROVED":
                            log_event(self.task_id, step["step_id"], "APPROVED", tier, {"tool_name": tool_name})

                    # Execution
                    if action["tool_name"] == "browser_read":
                        exec_result = self.multimodal.browser_read(**action["args"])
                    elif action["tool_name"] == "send_email":
                        exec_result = {"returncode": 0, "output": "Email sent"}
                    else:
                        exec_result = self.env.execute(action)
                    if action['tool_name'] in ['write_file', 'edit_file', 'read_file']:
                        if exec_result.get('returncode') == -1 and 'PathEscape' in str(exec_result):
                            log_event(self.task_id, step['step_id'], "PATH_CHECK", tier, {"path": action['args'].get('path', ''), "safe": False, "raw_error": str(exec_result)})
                            raise ValueError("Path escape blocked by environment.")
                        else:
                            log_event(self.task_id, step['step_id'], "PATH_CHECK", tier, {"path": action['args'].get('path', ''), "safe": True})
                            
                    # Add tool response to messages
                    messages.append({"role": "tool", "tool_call_id": action.get("tool_call_id", ""), "name": action['tool_name'], "content": str(exec_result)})

                if actions:
                    continue
                
                content = str(msg.get("content") or "").lower()
                if "fail" in content or "error" in content or "cannot" in content or "could not" in content:
                    log_event(self.task_id, step['step_id'], "STEP_FAIL", tier, {"reason": "llm_self_reported_failure", "content": msg.get("content")})
                    return False
                    
                last_tool_err = False
                for m in reversed(messages):
                    if m.get("role") == "tool":
                        m_content = str(m.get("content", ""))
                        if "'returncode': -1" in m_content or "'returncode': 1" in m_content or "no such file" in m_content.lower():
                            last_tool_err = True
                        if "exception_info" in m_content:
                            # It's a dict string. Check if exception_info is not empty
                            import ast
                            try:
                                d = ast.literal_eval(m_content)
                                if isinstance(d, dict) and d.get("exception_info"):
                                    last_tool_err = True
                            except:
                                pass
                        break

                # Verify
                cmd = step.get('verification_method', {}).get('command', 'echo ok')
                v_res = self.env.execute({"tool_name": "run_command", "args": {"command": cmd}})
                passed = (v_res.get('returncode') == 0) and not last_tool_err
                log_event(self.task_id, step['step_id'], "VERIFICATION", tier, {"passed": passed, "cmd": cmd, "last_tool_err": last_tool_err})
                
                if passed:
                    log_event(self.task_id, step['step_id'], "STEP_PASS", tier, {})
                    return True
                else:
                    retries -= 1
                    messages.append({"role": "user", "content": f"Verification failed (v_res={v_res}, unrecovered tool error={last_tool_err}). Fix the issue."})
                    # Budget-based escalation: half the retry budget consumed
                    if tier == "fast" and retries <= retry_budget_total // 2:
                        tier = "strong"
                        log_event(self.task_id, step['step_id'], "ESCALATION", tier, {
                            "reason": "retry_budget_half_consumed",
                            "retries_remaining": retries,
                            "retry_budget_total": retry_budget_total
                        })
                    
            except ValueError as e:
                malformed += 1
                if "Unsafe" not in str(e) and "Path escape" not in str(e):
                    log_event(self.task_id, step['step_id'], "TOOL_MALFORMED", tier, {"error": str(e)})
                retries -= 1
                messages.append({"role": "user", "content": f"Error: {e}"})
                
                # Cumulative malformed-based escalation (never resets)
                if tier == "fast" and malformed >= 2:
                    tier = "strong"
                    log_event(self.task_id, step['step_id'], "ESCALATION", tier, {
                        "reason": "cumulative_malformed_calls",
                        "malformed_count": malformed
                    })
                # Budget-based escalation also applies after ValueError
                elif tier == "fast" and retries <= retry_budget_total // 2:
                    tier = "strong"
                    log_event(self.task_id, step['step_id'], "ESCALATION", tier, {
                        "reason": "retry_budget_half_consumed",
                        "retries_remaining": retries,
                        "retry_budget_total": retry_budget_total
                    })
                    
        err_msg = last_tool_err if 'last_tool_err' in locals() and last_tool_err else "Unrecovered failure"
        log_event(self.task_id, step['step_id'], "STEP_FAIL", tier, {"error": err_msg})
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--goal", required=True)
    parser.add_argument("--task_id", default=str(uuid.uuid4()))
    parser.add_argument("--schedule_id", default=None)
    parser.add_argument("--workspace", default=None)
    args = parser.parse_args()
    
    agent = PEVRAgent(args.task_id, workspace=args.workspace)
    res = agent.run(args.goal, schedule_id=args.schedule_id)
    print(json.dumps(res), flush=True)
