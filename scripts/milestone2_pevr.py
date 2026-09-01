import json
import os
import sys
import time
from typing import List, Dict, Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'mini-swe-agent', 'src'))

from minisweagent.environments.gondolin import GondolinEnvironment
from minisweagent.models.utils.actions_toolcall import parse_toolcall_actions, BASH_TOOL
from minisweagent.exceptions import FormatError
import litellm

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

litellm.drop_params = True
os.environ["MSWEA_COST_TRACKING"] = "ignore_errors"


MODEL_NAME = "groq/openai/gpt-oss-120b"

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
                    "permitted_tools": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
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
                    "dependencies": {
                        "type": "array",
                        "items": {"type": "string"}
                    }
                },
                "required": ["step_id", "objective", "permitted_tools", "expected_output", "verification_method", "retry_budget", "dependencies"]
            }
        }
    },
    "required": ["steps"]
}

class PEVRAgent:
    def __init__(self, max_steps=10, max_tool_calls=20, max_time_seconds=300):
        self.env = GondolinEnvironment()
        self.max_steps = max_steps
        self.max_tool_calls = max_tool_calls
        self.max_time_seconds = max_time_seconds
        self.total_tool_calls = 0
        self.start_time = 0

    def generate_plan(self, goal: str) -> dict:
        prompt = f"Goal: {goal}\nCreate a step-by-step plan. Return strictly a JSON object matching this schema:\n{json.dumps(PLAN_SCHEMA, indent=2)}\nIMPORTANT: Tools available: list_files, read_file, write_file, edit_file, run_command, run_tests."
        messages = [{"role": "user", "content": prompt}]
        response = litellm.completion(
            model=MODEL_NAME,
            messages=messages,
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content
        return json.loads(content)

    def execute_step(self, step: dict):
        print(f"\n--- Executing Step: {step['step_id']} - {step['objective']} ---")
        history = [
            {"role": "system", "content": f"Objective: {step['objective']}\nYou MUST use one of the permitted tools: {', '.join(step['permitted_tools'])}. Output ONLY a valid tool call."}
        ]
        
        retries_left = step['retry_budget']
        
        while retries_left >= 0:
            if time.time() - self.start_time > self.max_time_seconds:
                raise TimeoutError("BUDGET EXCEEDED: Wall-clock time limit reached.")
            
            # Request action from LLM
            # Filter BASH_TOOL to only permitted tools
            permitted_tool_defs = [t for t in BASH_TOOL if t['function']['name'] in step['permitted_tools']]
            
            response = litellm.completion(
                model=MODEL_NAME,
                messages=history,
                tools=permitted_tool_defs if permitted_tool_defs else None,
                tool_choice="required" if permitted_tool_defs else "none"
            )
            msg = response.choices[0].message
            history.append(msg.model_dump(exclude_none=True))
            
            # Check budgets
            self.total_tool_calls += 1
            if self.total_tool_calls > self.max_tool_calls:
                raise Exception("BUDGET EXCEEDED: Total tool calls limit reached.")
                
            try:
                actions = parse_toolcall_actions(msg.tool_calls or [], format_error_template="{{error}}")
                action = actions[0]
                
                if action['tool_name'] not in step['permitted_tools']:
                    raise ValueError(f"Tool {action['tool_name']} not in permitted_tools: {step['permitted_tools']}")
                    
                print(f"Tool Call: {action['tool_name']} {action['args']}")
                exec_result = self.env.execute(action)
                print(f"Execution Result: {exec_result['returncode']} | Output: {exec_result['output'][:100]}")
                
                history.append({
                    "role": "tool",
                    "tool_call_id": action['tool_call_id'],
                    "name": action['tool_name'],
                    "content": exec_result['output'] or "Success"
                })
                
                # VERIFIER
                verif = step['verification_method']
                if verif['type'] == 'run_command':
                    v_res = self.env.execute({"tool_name": "run_command", "args": {"command": verif['command']}})
                    print(f"VERIFIER ({verif['command']}) -> {v_res['returncode']}")
                    if v_res['returncode'] == 0:
                        print("VERIFICATION PASSED!")
                        return True
                    else:
                        print(f"VERIFICATION FAILED: {v_res['output']}")
                        err_msg = f"Verification failed. Command '{verif['command']}' returned {v_res['returncode']}. Output: {v_res['output']}. Fix the issue and try again."
                        history.append({"role": "user", "content": err_msg})
                
            except Exception as e:
                print(f"Error executing action: {e}")
                history.append({"role": "user", "content": f"Action failed: {e}. Try again."})
                
            retries_left -= 1
            print(f"Retries left: {retries_left}")
            
        print("STEP FAILED: Retry budget exhausted.")
        return False

    def run(self, goal: str):
        self.start_time = time.time()
        print(f"=== PEVR LOOP START ===")
        print(f"Goal: {goal}")
        plan = self.generate_plan(goal)
        
        if len(plan.get("steps", [])) > self.max_steps:
            raise Exception("BUDGET EXCEEDED: Too many steps in plan.")
            
        print("PLAN GENERATED:")
        print(json.dumps(plan, indent=2))
        
        for step in plan['steps']:
            success = self.execute_step(step)
            if not success:
                raise Exception(f"Task failed at step: {step['step_id']}")
                
        print("=== TASK COMPLETE ===")
        return True

if __name__ == "__main__":
    agent = PEVRAgent()
    
    test_mode = sys.argv[1] if len(sys.argv) > 1 else "success"
    
    if test_mode == "success":
        agent.run("Create a file 'math.py' with an add function. Then create 'test_math.py' that imports and tests it. Finally run python test_math.py (DO NOT USE pytest, use plain python)")
    elif test_mode == "failure":
        agent.run("Create a file 'buggy.py' with a function 'def add(a, b): return a - b'. Create 'test_buggy.py' with 'def test_add(): assert add(2,2) == 4'. Verify by running \"python -c 'from buggy import add; assert add(2,2) == 4'\". Do NOT fix the bug initially so we see the verifier catch it.")
    elif test_mode == "budget":
        agent = PEVRAgent(max_time_seconds=5)
        try:
            agent.run("Create a file 'slow.py', sleep for 10 seconds, then verify it.")
        except Exception as e:
            print(f"BUDGET ENFORCEMENT CAUGHT: {e}")
