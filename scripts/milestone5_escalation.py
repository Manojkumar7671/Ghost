import json
import os
import sys
import time
import logging
from typing import List, Dict, Any

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
escalation_logger = logging.getLogger("EscalationRouter")

class ModelGateway:
    def __init__(self, planning_model: str, fast_model: str, strong_model: str):
        self.planning_model = planning_model
        self.fast_model = fast_model
        self.strong_model = strong_model
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
            response = litellm.completion(model=model_name, messages=messages, tools=dummy_tool)
            msg = response.choices[0].message
            is_native = bool(msg.tool_calls and len(msg.tool_calls) > 0)
            self.native_tool_support[model_name] = is_native
            logger.info(f"[PROBE] Model: {model_name} | Native Tool Support: {is_native}")
            return is_native
        except Exception as e:
            logger.error(f"[PROBE ERROR] Model: {model_name} failed probe: {e}")
            self.native_tool_support[model_name] = False
            return False

    def call_planner(self, messages: list, json_schema: dict) -> dict:
        prompt = messages[-1]["content"]
        prompt += f"\n\nYou MUST return ONLY a JSON object matching this schema:\n{json.dumps(json_schema)}"
        messages[-1]["content"] = prompt
        response = litellm.completion(model=self.planning_model, messages=messages, response_format={"type": "json_object"})
        return json.loads(response.choices[0].message.content)

    def call_executor(self, messages: list, tools: list, tier: str = "fast") -> tuple[list, dict]:
        model = self.fast_model if tier == "fast" else self.strong_model
        is_native = self.native_tool_support.get(model, False)
        
        logger.info(f"[GATEWAY call_executor] Tier: {tier.upper()} | Model: {model} | Mode: {'NATIVE' if is_native else 'FALLBACK'}")
        
        try:
            if is_native:
                response = litellm.completion(
                    model=model,
                    messages=messages,
                    tools=tools,
                    tool_choice="required" if tools else "none"
                )
                msg = response.choices[0].message
                if not msg.tool_calls:
                    raise ValueError("No tool calls found in native response.")
                    
                actions = []
                for tc in msg.tool_calls:
                    actions.append({
                        "tool_name": tc.function.name,
                        "args": json.loads(tc.function.arguments),
                        "tool_call_id": tc.id
                    })
                return actions, msg.model_dump(exclude_none=True)
            else:
                fallback_msg = list(messages)
                sys_instruction = f"You are in FALLBACK tool mode. You MUST respond with ONLY a JSON object containing a 'tool_calls' array. Available tools:\n{json.dumps(tools)}"
                if fallback_msg[0]["role"] == "system":
                    fallback_msg[0]["content"] += "\n" + sys_instruction
                else:
                    fallback_msg.insert(0, {"role": "system", "content": sys_instruction})
                    
                response = litellm.completion(model=model, messages=fallback_msg, response_format={"type": "json_object"})
                content = response.choices[0].message.content
                data = json.loads(content)
                if "tool_calls" not in data:
                    raise ValueError("Missing 'tool_calls' in fallback response.")
                    
                actions = []
                for i, tc in enumerate(data["tool_calls"]):
                    actions.append({
                        "tool_name": tc["name"],
                        "args": tc["arguments"],
                        "tool_call_id": f"fallback_{i}"
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
    def __init__(self, gateway: ModelGateway):
        self.env = GondolinEnvironment()
        self.gateway = gateway
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
        
        initial_retries = step['retry_budget']
        retries_left = initial_retries
        current_tier = "fast"
        malformed_count = 0
        
        while retries_left >= 0:
            permitted_tool_defs = [t for t in BASH_TOOL if t['function']['name'] in step['permitted_tools']]
            
            try:
                actions, msg_dump = self.gateway.call_executor(history, permitted_tool_defs, tier=current_tier)
                if not actions:
                    raise ValueError("Empty actions array returned.")
                    
                action = actions[0]
                if action['tool_name'] not in step['permitted_tools']:
                    raise ValueError(f"Tool {action['tool_name']} not in permitted_tools")
                    
                malformed_count = 0
                history.append(msg_dump)
                print(f"[{current_tier.upper()} TIER] Tool Call: {action['tool_name']} {action['args']}")
                
                exec_result = self.env.execute(action)
                print(f"Execution Result: {exec_result['returncode']} | Output Preview: {exec_result['output'][:100]}")
                
                history.append({
                    "role": "tool",
                    "tool_call_id": action['tool_call_id'],
                    "name": action['tool_name'],
                    "content": exec_result['output'] or "Success"
                })
                
                # VERIFIER
                verif = step['verification_method']
                v_res = self.env.execute({"tool_name": "run_command", "args": {"command": verif['command']}})
                print(f"VERIFIER ({verif['command']}) -> {v_res['returncode']}")
                if v_res['returncode'] == 0:
                    print("VERIFICATION PASSED!")
                    return True
                else:
                    err_msg = f"Verification failed. Command '{verif['command']}' returned {v_res['returncode']}. Fix the issue and try again."
                    history.append({"role": "user", "content": err_msg})
                    retries_left -= 1
                    
                    if current_tier == "fast" and retries_left <= initial_retries / 2.0:
                        current_tier = "strong"
                        msg = f"[ESCALATION] Step {step['step_id']}: Escalating to strong tier because half of retry budget is exhausted."
                        escalation_logger.warning(msg)
                        print(msg)
                        
            except ValueError as e:
                malformed_count += 1
                history.append({"role": "user", "content": f"Action formatting failed: {e}. Try again."})
                retries_left -= 1
                
                if current_tier == "fast" and malformed_count >= 2:
                    current_tier = "strong"
                    msg = f"[ESCALATION] Step {step['step_id']}: Escalating to strong tier due to 2+ consecutive malformed tool calls."
                    escalation_logger.warning(msg)
                    print(msg)
                    
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
    
    gw = ModelGateway(
        planning_model="groq/openai/gpt-oss-120b",
        fast_model="groq/openai/gpt-oss-20b",
        strong_model="groq/openai/gpt-oss-120b"
    )
    
    # 1. Capability probe
    gw.probe_capabilities("groq/openai/gpt-oss-20b")
    gw.probe_capabilities("groq/openai/gpt-oss-120b")
    
    if test_mode == "test1" or test_mode == "all":
        print("\n--- TEST 1: FAST TIER SUCCEEDS ---")
        agent = PEVRAgent(gateway=gw)
        # Give it a very simple goal with 1 step.
        agent.run("Simply run the 'ls' command to list files.")
        
    if test_mode == "test2" or test_mode == "all":
        print("\n--- TEST 2: FORCED ESCALATION ---")
        # To simulate a fast tier failure without breaking the real model, we will mock litellm just for the fast model to fail verification constantly or return bad formats.
        # Actually, if we give it a task that's practically impossible to verify properly unless it writes a complex Python script, the fast model might fail. 
        # But a mock is 100% reliable for demonstration.
        
        # We mock call_executor to track calls. If model is 20b, we artificially raise ValueError to simulate malformed call.
        original_call_executor = gw.call_executor
        def mock_call_executor(messages, tools, tier):
            if tier == "fast":
                raise ValueError("Simulated malformed JSON response from fast model.")
            return original_call_executor(messages, tools, tier)
            
        gw.call_executor = mock_call_executor
        agent = PEVRAgent(gateway=gw)
        try:
            agent.run("Run 'pwd'.")
        except Exception as e:
            print(f"Run ended: {e}")
            
        # restore
        gw.call_executor = original_call_executor

    if test_mode == "test3" or test_mode == "all":
        print("\n--- TEST 3: FULL PEVR RUN ---")
        agent = PEVRAgent(gateway=gw)
        agent.run("Create a file hello.txt containing 'world', then run cat hello.txt.")
