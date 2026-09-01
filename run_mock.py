import sys
sys.path.append('mini-swe-agent/src')
from minisweagent.pevr_service import PEVRAgent
agent = PEVRAgent('test-mock')
# Mock out the litellm calls to succeed!
def call_planner_mock(goal):
    return {"steps": [{"step_id": "s1", "objective": goal, "permitted_tools": ["run_command"], "verification_method": {"type": "run_command", "command": "echo ok"}, "retry_budget": 3, "dependencies": []}]}
def call_executor_mock(messages, tools, tier):
    return [{"tool_name": "run_command", "args": {"command": "echo 'did it'"}, "tool_call_id": "call_1"}], {"role": "assistant", "content": "I did it"}
agent.gw.call_planner = call_planner_mock
agent.gw.call_executor = call_executor_mock
import json
print(json.dumps(agent.run("do something")))
