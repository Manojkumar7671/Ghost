import os
import sys
import json
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'mini-swe-agent', 'src'))

from minisweagent.environments.gondolin import GondolinEnvironment
from minisweagent.models.utils.actions_toolcall import parse_toolcall_actions, BASH_TOOL
from minisweagent.exceptions import FormatError

print("=== TEST 1: Path Escape Attempt ===")
env = GondolinEnvironment()
action = {
    "tool_name": "write_file",
    "args": {
        "path": "../../etc/passwd",
        "content": "hacked"
    }
}
result = env.execute(action)
print(f"Result: {result}")
if result["returncode"] == -1 and "Path escape detected!" in result["exception_info"]:
    print("Test 1 PASS: Path escape rejected!")
else:
    print("Test 1 FAIL")

print("\n=== TEST 2: Prose-as-Command ===")
class MockToolCall:
    def __init__(self, name, args):
        self.function = MagicMock()
        self.function.name = name
        self.function.arguments = json.dumps(args)
        self.id = "mock_id"

try:
    # No tool calls
    parse_toolcall_actions([], format_error_template="{{error}}")
    print("Test 2 FAIL: Did not reject prose-as-command.")
except FormatError as e:
    print(f"Rejected with FormatError: {e.messages[0]['content']}")
    print("Test 2 PASS: Prose-as-command rejected!")

print("\n=== TEST 3: Malformed Call ===")
try:
    bad_call = MockToolCall("write_file", {"path": "test.txt"}) # Missing content
    parse_toolcall_actions([bad_call], format_error_template="{{error}}")
    print("Test 3 FAIL: Did not reject malformed call.")
except FormatError as e:
    print(f"Rejected with FormatError: {e.messages[0]['content']}")
    print("Test 3 PASS: Malformed call rejected!")

print("\n=== TEST 4: Valid Call ===")
try:
    # 1. Write file
    write_call = MockToolCall("write_file", {"path": "test.txt", "content": "hello world"})
    actions = parse_toolcall_actions([write_call], format_error_template="{{error}}")
    write_res = env.execute(actions[0])
    print(f"Write result: {write_res}")
    
    # 2. Read file
    read_call = MockToolCall("read_file", {"path": "test.txt"})
    actions2 = parse_toolcall_actions([read_call], format_error_template="{{error}}")
    read_res = env.execute(actions2[0])
    print(f"Read result: {read_res}")
    
    if "hello world" in read_res["output"]:
        print("Test 4 PASS: Valid call works end-to-end!")
    else:
        print("Test 4 FAIL: Output did not contain expected content.")
except Exception as e:
    print(f"Test 4 FAIL: {e}")

