import json
import os
import sys
import time
import logging
from typing import List, Dict, Any
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from collections import deque

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'mini-swe-agent', 'src'))
from minisweagent.environments.gondolin import GondolinEnvironment
from minisweagent.models.utils.actions_toolcall import BASH_TOOL

import litellm
litellm.drop_params = True
os.environ["MSWEA_COST_TRACKING"] = "ignore_errors"
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                try:
                    key, val = line.strip().split('=', 1)
                    os.environ[key] = val.strip('"\'')
                except:
                    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(message)s")
logger = logging.getLogger("Gateway")
audit_logger = logging.getLogger("API_AUDIT")

# ==========================================
# 1 & 2. Connector Interface & Config
# ==========================================

GITHUB_CONFIG = {
    "name": "github_public",
    "base_url": "https://api.github.com",
    "auth_method": "bearer_token",
    "allowed_operations": ["GET"],
    "request_schema": {
        "type": "object",
        "properties": {
            "endpoint": {"type": "string"},
            "method": {"type": "string", "default": "GET"}
        },
        "required": ["endpoint"]
    },
    "response_schema": {"type": "object"},
    "rate_limit": {"requests_per_minute": 3},  # Small limit to test queuing easily
    "timeout": 10,
    "retry_policy": {"max_retries": 1, "backoff_factor": 1.5},
    "data_sensitivity": "public"
}

GITHUB_TOOL = {
    "type": "function",
    "function": {
        "name": "github_lookup",
        "description": "Read-only lookup for GitHub public API (e.g., /repos/{owner}/{repo}).",
        "parameters": GITHUB_CONFIG["request_schema"]
    }
}

ALL_TOOLS = BASH_TOOL + [GITHUB_TOOL]

# ==========================================
# 3, 4, 5. Connector Implementation
# ==========================================

class APIConnector:
    def __init__(self, config: dict):
        self.config = config
        self.call_history = deque()
        self.token = os.environ.get("GITHUB_TOKEN", "")
        
    def _enforce_rate_limit(self):
        now = time.time()
        # Clean up old calls
        while self.call_history and now - self.call_history[0] > 60:
            self.call_history.popleft()
            
        limit = self.config["rate_limit"]["requests_per_minute"]
        if len(self.call_history) >= limit:
            sleep_time = 60 - (now - self.call_history[0]) + 0.1
            audit_logger.warning(f"[RATE LIMIT] Exhausted quota ({limit}/min). Queuing request for {sleep_time:.2f}s...")
            time.sleep(sleep_time)
            self._enforce_rate_limit() # Recheck
            
        self.call_history.append(time.time())

    def execute(self, endpoint: str, method: str = "GET") -> dict:
        # HARD REJECT side-effects
        method = method.upper()
        if method not in self.config["allowed_operations"]:
            error_msg = f"Operation {method} not in allowed_operations {self.config['allowed_operations']}. Side effects are strictly forbidden."
            audit_logger.error(f"[AUDIT REJECT] connector={self.config['name']} op={method} endpoint={endpoint} reason='Disallowed Method'")
            raise ValueError(error_msg)
            
        self._enforce_rate_limit()
        
        url = f"{self.config['base_url']}{endpoint if endpoint.startswith('/') else '/' + endpoint}"
        req = Request(url, method=method)
        req.add_header("User-Agent", "Ghost-Agent/1.0")
        req.add_header("Accept", "application/vnd.github.v3+json")
        
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
            
        retries = 0
        max_retries = self.config["retry_policy"]["max_retries"]
        
        while retries <= max_retries:
            start_t = time.time()
            status = None
            response_size = 0
            
            try:
                with urlopen(req, timeout=self.config["timeout"]) as response:
                    status = response.getcode()
                    data = response.read()
                    response_size = len(data)
                    latency = time.time() - start_t
                    
                    audit_logger.info(f"[AUDIT] connector={self.config['name']} op={method} endpoint={endpoint} status={status} latency={latency*1000:.0f}ms size={response_size}B retries={retries}")
                    return {"returncode": 0, "output": data.decode('utf-8')}
                    
            except HTTPError as e:
                status = e.code
                latency = time.time() - start_t
                audit_logger.error(f"[AUDIT] connector={self.config['name']} op={method} endpoint={endpoint} status={status} latency={latency*1000:.0f}ms size=0B retries={retries}")
                return {"returncode": status, "output": str(e)}
            except Exception as e:
                latency = time.time() - start_t
                audit_logger.error(f"[AUDIT] connector={self.config['name']} op={method} endpoint={endpoint} status=ERR latency={latency*1000:.0f}ms size=0B retries={retries} err='{e}'")
                retries += 1
                if retries <= max_retries:
                    time.sleep(self.config["retry_policy"]["backoff_factor"] ** retries)
                else:
                    return {"returncode": 1, "output": str(e)}

# ==========================================
# Gateway & PEVR (from M3, adapted for ALL_TOOLS)
# ==========================================

class ModelGateway:
    def __init__(self, planning_model: str, execution_model: str):
        self.planning_model = planning_model
        self.execution_model = execution_model
        self.native_tool_support = {}
        
    def call_planner(self, messages: list, json_schema: dict) -> dict:
        prompt = messages[-1]["content"]
        prompt += f"\n\nYou MUST return ONLY a JSON object matching this schema:\n{json.dumps(json_schema)}"
        messages[-1]["content"] = prompt
        response = litellm.completion(model=self.planning_model, messages=messages, response_format={"type": "json_object"})
        return json.loads(response.choices[0].message.content)

    def call_executor(self, messages: list, tools: list) -> tuple[list, dict]:
        # Skipping probe logic for brevity in this test file, assuming native support for the 120b model
        response = litellm.completion(
            model=self.execution_model,
            messages=messages,
            tools=tools,
            tool_choice="required" if tools else "none"
        )
        msg = response.choices[0].message
        actions = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                actions.append({
                    "tool_name": tc.function.name,
                    "args": json.loads(tc.function.arguments),
                    "tool_call_id": tc.id
                })
        return actions, msg.model_dump(exclude_none=True)

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "step_id": {"type": "string"},
                    "objective": {"type": "string"},
                    "permitted_tools": {"type": "array", "items": {"type": "string"}},
                    "expected_output": {"type": "string"},
                    "verification_method": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": ["run_command"]},
                            "command": {"type": "string"}
                        },
                        "required": ["type", "command"]
                    },
                    "retry_budget": {"type": "integer"},
                    "dependencies": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["step_id", "objective", "permitted_tools", "expected_output", "verification_method", "retry_budget", "dependencies"]
            }
        }
    },
    "required": ["steps"]
}

class PEVRAgent:
    def __init__(self, gateway: ModelGateway):
        self.env = GondolinEnvironment()
        self.gateway = gateway
        self.github_connector = APIConnector(GITHUB_CONFIG)
        self.start_time = 0

    def generate_plan(self, goal: str) -> dict:
        prompt = f"Goal: {goal}\nCreate a step-by-step plan.\nIMPORTANT: Tools available: list_files, read_file, write_file, edit_file, run_command, run_tests, github_lookup."
        messages = [{"role": "user", "content": prompt}]
        return self.gateway.call_planner(messages, PLAN_SCHEMA)

    def execute_step(self, step: dict):
        print(f"\n--- Executing Step: {step['step_id']} - {step['objective']} ---")
        history = [
            {"role": "system", "content": f"Objective: {step['objective']}\nYou MUST use one of the permitted tools: {', '.join(step['permitted_tools'])}."}
        ]
        
        retries_left = step['retry_budget']
        
        while retries_left >= 0:
            permitted_tool_defs = [t for t in ALL_TOOLS if t['function']['name'] in step['permitted_tools']]
            actions, msg_dump = self.gateway.call_executor(history, permitted_tool_defs)
            history.append(msg_dump)
            
            action = actions[0]
            
            if action['tool_name'] not in step['permitted_tools']:
                raise ValueError(f"Tool {action['tool_name']} not in permitted_tools: {step['permitted_tools']}")
                
            print(f"Tool Call: {action['tool_name']} {action['args']}")
            
            if action['tool_name'] == 'github_lookup':
                try:
                    exec_result = self.github_connector.execute(
                        endpoint=action['args'].get('endpoint'),
                        method=action['args'].get('method', 'GET')
                    )
                except ValueError as ve:
                    # Hard reject caught
                    exec_result = {"returncode": 1, "output": str(ve)}
            else:
                exec_result = self.env.execute(action)
                
            out_preview = exec_result['output'][:200] + ('...' if len(exec_result['output']) > 200 else '')
            print(f"Execution Result: {exec_result['returncode']} | Output Preview: {out_preview}")
            
            history.append({
                "role": "tool",
                "tool_call_id": action['tool_call_id'],
                "name": action['tool_name'],
                "content": exec_result['output'] or "Success"
            })
            
            verif = step['verification_method']
            v_res = self.env.execute({"tool_name": "run_command", "args": {"command": verif['command']}})
            print(f"VERIFIER ({verif['command']}) -> {v_res['returncode']}")
            if v_res['returncode'] == 0:
                print("VERIFICATION PASSED!")
                return True
            else:
                err_msg = f"Verification failed. Command '{verif['command']}' returned {v_res['returncode']}."
                history.append({"role": "user", "content": err_msg})
                retries_left -= 1
            
        print("STEP FAILED: Retry budget exhausted.")
        return False

    def run(self, goal: str):
        self.start_time = time.time()
        print(f"=== PEVR LOOP START ===")
        plan = self.generate_plan(goal)
        for step in plan['steps']:
            if not self.execute_step(step):
                raise Exception(f"Task failed at step: {step['step_id']}")
        print("=== TASK COMPLETE ===")
        return True

if __name__ == "__main__":
    test_mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    connector = APIConnector(GITHUB_CONFIG)
    
    if test_mode == "test1" or test_mode == "all":
        print("\n--- TEST 1: REAL READ CALL ---")
        res = connector.execute(endpoint="/repos/octocat/Hello-World", method="GET")
        print(f"Result Return Code: {res['returncode']}")
        print(f"Response Preview: {res['output'][:200]}")
        
    if test_mode == "test2" or test_mode == "all":
        print("\n--- TEST 2: REJECT SIDE EFFECT (POST) ---")
        try:
            connector.execute(endpoint="/repos/octocat/Hello-World/issues", method="POST")
        except Exception as e:
            print(f"Hard Rejection Triggered: {e}")
            
    if test_mode == "test3" or test_mode == "all":
        print("\n--- TEST 3: RATE LIMITING (3 req/min) ---")
        # limit is 3/min. We already did 1 in TEST 1. Let's do 3 more rapidly to force a queue
        for i in range(3):
            print(f"Rapid Call {i+1}...")
            start = time.time()
            connector.execute(endpoint="/rate_limit", method="GET")
            print(f"Call {i+1} finished in {time.time() - start:.2f}s")
            
