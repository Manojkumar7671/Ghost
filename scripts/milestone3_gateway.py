import json
import os
import sys
import time
from typing import List, Dict, Any
import logging

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

class ModelGateway:
    def __init__(self, planning_model: str, execution_model: str):
        self.planning_model = planning_model
        self.execution_model = execution_model
        self.native_tool_support = {}
        
    def probe_capabilities(self, model_name: str) -> bool:
        logger.info(f"Probing capabilities for model: {model_name}")
        dummy_tool = [{
            "type": "function",
            "function": {
                "name": "probe_tool",
                "description": "A dummy tool to test capabilities",
                "parameters": {
                    "type": "object",
                    "properties": {"value": {"type": "integer"}},
                    "required": ["value"]
                }
            }
        }]
        messages = [{"role": "user", "content": "You MUST use the probe_tool and pass value=42. Do not output anything else."}]
        
        try:
            start_t = time.time()
            response = litellm.completion(
                model=model_name,
                messages=messages,
                tools=dummy_tool,
            )
            latency = time.time() - start_t
            msg = response.choices[0].message
            is_native = bool(msg.tool_calls and len(msg.tool_calls) > 0)
            logger.info(f"[PROBE] Model: {model_name} | Latency: {latency:.2f}s | Native Tool Support: {is_native}")
            self.native_tool_support[model_name] = is_native
            return is_native
        except Exception as e:
            logger.error(f"[PROBE ERROR] Model: {model_name} failed probe: {e}")
            logger.info(f"[PROBE] Model: {model_name} | Native Tool Support: False (Exception)")
            self.native_tool_support[model_name] = False
            return False

    def call_planner(self, messages: list, json_schema: dict) -> dict:
        model = self.planning_model
        logger.info(f"[GATEWAY call_planner] Model: {model}")
        start_t = time.time()
        
        prompt = messages[-1]["content"]
        prompt += f"\n\nYou MUST return ONLY a JSON object matching this schema:\n{json.dumps(json_schema)}"
        messages[-1]["content"] = prompt
        
        try:
            response = litellm.completion(
                model=model,
                messages=messages,
                response_format={"type": "json_object"}
            )
            latency = time.time() - start_t
            usage = response.usage.model_dump() if response.usage else {}
            logger.info(f"[GATEWAY call_planner] SUCCESS | Latency: {latency:.2f}s | Tokens: {usage}")
            
            content = response.choices[0].message.content
            return json.loads(content)
        except Exception as e:
            logger.error(f"[GATEWAY call_planner] ERROR | Latency: {time.time() - start_t:.2f}s | Exception: {e}")
            raise e

    def call_executor(self, messages: list, tools: list) -> tuple[list, dict]:
        model = self.execution_model
        is_native = self.native_tool_support.get(model, False)
        
        logger.info(f"[GATEWAY call_executor] Model: {model} | Mode: {'NATIVE' if is_native else 'FALLBACK'}")
        start_t = time.time()
        
        try:
            if is_native:
                response = litellm.completion(
                    model=model,
                    messages=messages,
                    tools=tools,
                    tool_choice="required" if tools else "none"
                )
                latency = time.time() - start_t
                usage = response.usage.model_dump() if response.usage else {}
                logger.info(f"[GATEWAY call_executor] SUCCESS | Latency: {latency:.2f}s | Tokens: {usage}")
                
                msg = response.choices[0].message
                if not msg.tool_calls:
                    raise ValueError("No tool calls found in the native response.")
                    
                actions = []
                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments)
                    actions.append({
                        "tool_name": tc.function.name,
                        "args": args,
                        "tool_call_id": tc.id
                    })
                return actions, msg.model_dump(exclude_none=True)
                
            else:
                fallback_msg = list(messages)
                tools_desc = json.dumps(tools, indent=2)
                sys_instruction = f"You are in FALLBACK tool mode. You MUST respond with ONLY a JSON object containing a 'tool_calls' array. Example: {{\"tool_calls\": [{{\"name\": \"run_command\", \"arguments\": {{\"command\": \"ls\"}}}}]}}. Available tools:\n{tools_desc}"
                
                if fallback_msg[0]["role"] == "system":
                    fallback_msg[0]["content"] += "\n" + sys_instruction
                else:
                    fallback_msg.insert(0, {"role": "system", "content": sys_instruction})
                    
                response = litellm.completion(
                    model=model,
                    messages=fallback_msg,
                    response_format={"type": "json_object"}
                )
                latency = time.time() - start_t
                usage = response.usage.model_dump() if response.usage else {}
                logger.info(f"[GATEWAY call_executor] SUCCESS (FALLBACK) | Latency: {latency:.2f}s | Tokens: {usage}")
                
                content = response.choices[0].message.content
                data = json.loads(content)
                if "tool_calls" not in data:
                    raise ValueError("JSON response missing 'tool_calls' array in fallback mode.")
                    
                actions = []
                for i, tc in enumerate(data["tool_calls"]):
                    actions.append({
                        "tool_name": tc["name"],
                        "args": tc["arguments"],
                        "tool_call_id": f"fallback_call_{i}_{int(time.time())}"
                    })
                
                pseudo_msg = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": a["tool_call_id"], "type": "function", "function": {"name": a["tool_name"], "arguments": json.dumps(a["args"])}} 
                        for a in actions
                    ]
                }
                return actions, pseudo_msg
                
        except Exception as e:
            logger.error(f"[GATEWAY call_executor] ERROR | Latency: {time.time() - start_t:.2f}s | Exception: {e}")
            raise ValueError(f"Gateway execution error: {e}")

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
    def __init__(self, gateway: ModelGateway, max_steps=10, max_tool_calls=20, max_time_seconds=300):
        self.env = GondolinEnvironment()
        self.gateway = gateway
        self.max_steps = max_steps
        self.max_tool_calls = max_tool_calls
        self.max_time_seconds = max_time_seconds
        self.total_tool_calls = 0
        self.start_time = 0

    def generate_plan(self, goal: str) -> dict:
        prompt = f"Goal: {goal}\nCreate a step-by-step plan.\nIMPORTANT: Tools available: list_files, read_file, write_file, edit_file, run_command, run_tests."
        messages = [{"role": "user", "content": prompt}]
        return self.gateway.call_planner(messages, PLAN_SCHEMA)

    def execute_step(self, step: dict):
        print(f"\n--- Executing Step: {step['step_id']} - {step['objective']} ---")
        history = [
            {"role": "system", "content": f"Objective: {step['objective']}\nYou MUST use one of the permitted tools: {', '.join(step['permitted_tools'])}."}
        ]
        
        retries_left = step['retry_budget']
        
        while retries_left >= 0:
            if time.time() - self.start_time > self.max_time_seconds:
                raise TimeoutError("BUDGET EXCEEDED: Wall-clock time limit reached.")
            
            permitted_tool_defs = [t for t in BASH_TOOL if t['function']['name'] in step['permitted_tools']]
            
            self.total_tool_calls += 1
            if self.total_tool_calls > self.max_tool_calls:
                raise Exception("BUDGET EXCEEDED: Total tool calls limit reached.")
                
            try:
                actions, msg_dump = self.gateway.call_executor(history, permitted_tool_defs)
                history.append(msg_dump)
                
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
        
        print("PLAN GENERATED:")
        print(json.dumps(plan, indent=2))
        
        for step in plan['steps']:
            success = self.execute_step(step)
            if not success:
                raise Exception(f"Task failed at step: {step['step_id']}")
                
        print("=== TASK COMPLETE ===")
        return True

if __name__ == "__main__":
    test_mode = sys.argv[1] if len(sys.argv) > 1 else "probe_success"
    
    if test_mode == "probe_success":
        print("--- TEST 1: CAPABILITY PROBE ON WORKING MODEL ---")
        gw = ModelGateway("groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-120b")
        supported = gw.probe_capabilities("groq/openai/gpt-oss-120b")
        print(f"Native Tool Support Detected: {supported}")
        
    elif test_mode == "probe_fail":
        print("\n--- TEST 2: CAPABILITY PROBE ON MODEL WITHOUT TOOL SUPPORT ---")
        gw = ModelGateway("groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-120b")
        
        original_completion = litellm.completion
        def mock_completion(*args, **kwargs):
            if kwargs.get('tools') and len(kwargs['tools']) == 1 and kwargs['tools'][0]['function']['name'] == 'probe_tool':
                class DummyMessage:
                    content = "I cannot use tools."
                    tool_calls = None
                    def model_dump(self, *a, **k): return {"content": self.content, "role": "assistant"}
                class DummyChoice:
                    message = DummyMessage()
                class DummyResponse:
                    choices = [DummyChoice()]
                    usage = None
                return DummyResponse()
            return original_completion(*args, **kwargs)
        litellm.completion = mock_completion
        
        supported = gw.probe_capabilities("groq/openai/gpt-oss-120b")
        print(f"Native Tool Support Detected: {supported}")
        
        try:
            res, _ = gw.call_executor([{"role": "user", "content": "Use run_command to run 'echo hello'"}], BASH_TOOL)
            print(f"Fallback mode successfully executed and parsed: {res[0]['tool_name']} {res[0]['args']}")
        except Exception as e:
            print(f"Fallback mode failed: {e}")
            
    elif test_mode == "pevr_success":
        print("\n--- TEST 3: FULL PEVR SUCCESS TEST THROUGH GATEWAY ---")
        gw = ModelGateway("groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-120b")
        gw.probe_capabilities("groq/openai/gpt-oss-120b")
        agent = PEVRAgent(gateway=gw)
        agent.run("Create a file 'math.py' with an add function. Then create 'test_math.py' that imports add from math and tests it. Finally run python test_math.py (DO NOT USE pytest, use plain python).")

