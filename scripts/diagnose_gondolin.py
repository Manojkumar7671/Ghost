import os
import sys
import subprocess
import json
from pathlib import Path

# Load env
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
with open(env_path) as f:
    for line in f:
        if line.strip() and not line.startswith('#'):
            key, val = line.strip().split('=', 1)
            os.environ[key] = val.strip('"\'')
            os.environ['MSWEA_COST_TRACKING'] = 'ignore_errors'


sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'mini-swe-agent', 'src'))

from minisweagent.environments.gondolin import GondolinEnvironment
from minisweagent.models.litellm_model import LitellmModel, LitellmModelConfig

def run_checks():
    overall_pass = True
    print("=== CHECK 1: Environment Identity ===")
    env = GondolinEnvironment()
    class_name = env.__class__.__name__
    print(f"Instantiated class: {class_name}")
    if class_name != "GondolinEnvironment":
        print(f"FAIL: Class name is not GondolinEnvironment, it's {class_name}")
        overall_pass = False
    else:
        print("PASS")
    
    print("\n=== CHECK 2: Real Write Path ===")
    test_file_name = "gondolin_diagnostic_test.txt"
    test_file_host_path = os.path.join(env.config.cwd, test_file_name)
    test_file_vm_path = os.path.join(env.config.cwd, test_file_name)
    test_content = "gondolin_write_test"
    
    result = env.execute({"command": f"echo '{test_content}' > {test_file_vm_path}"})
    print(f"Agent write result returncode: {result['returncode']}")
    if result["returncode"] != 0:
        print(f"FAIL: Could not write to Gondolin environment! Output: {result['output']}")
        overall_pass = False
    elif os.path.exists(test_file_host_path):
        print(f"FAIL: File '{test_file_host_path}' physically exists on the host Mac filesystem directly! Gondolin is leaking into the host.")
        os.remove(test_file_host_path)
        overall_pass = False
    else:
        gondolin_cli = env.config.gondolin_cli
        indep_result = subprocess.run([
            "node", gondolin_cli, "exec", "--mount-hostfs", f"{os.path.join(os.path.dirname(env.config.cwd), '.gondolin_sandbox_' + os.path.basename(env.config.cwd))}:{env.config.cwd}", "--", "cat", test_file_vm_path
        ], capture_output=True, text=True)
        
        print(f"Independent read result from VM: {indep_result.stdout.strip()}")
        if test_content not in indep_result.stdout:
            print("FAIL: File was not physically found inside the Gondolin VM via independent check!")
            overall_pass = False
        else:
            print("PASS: File exists inside VM but NOT on host Mac.")

    print("\n=== CHECK 3: Tool-Call Format ===")
    config = LitellmModelConfig(model_name="groq/openai/gpt-oss-120b")
    
    model = LitellmModel(model_name="groq/openai/gpt-oss-120b")
    
    messages = [
        {"role": "system", "content": "You are an agent. Use the execute_bash tool to list the current directory. You MUST output a tool call."},
        {"role": "user", "content": "List the files in the directory."}
    ]
    
    orig_query = model._query
    raw_response_obj = None
    def mock_query(messages, **kwargs):
        nonlocal raw_response_obj
        res = orig_query(messages, **kwargs)
        raw_response_obj = res
        return res
        
    model._query = mock_query
    
    try:
        model.query(messages)
    except Exception as e:
        print(f"Model query exception: {e}")
        
    if not raw_response_obj:
        print("FAIL: Could not capture raw response from model. Does it have an API key configured?")
        overall_pass = False
    else:
        msg = raw_response_obj.choices[0].message
        print("RAW MODEL RESPONSE:")
        print(f"Content (Prose): {msg.content}")
        print(f"Tool Calls (Native): {msg.tool_calls}")
        
        is_native = msg.tool_calls is not None and len(msg.tool_calls) > 0
        if is_native:
            print("PASS: NATIVE STRUCTURED TOOL CALL DETECTED")
        else:
            print("FAIL: Tool format is PLAIN PROSE pretending to be a command, not a native tool call.")
            overall_pass = False

    print("\n--- DIAGNOSTIC RESULT ---")
    if overall_pass:
        print("ALL CHECKS PASSED.")
        sys.exit(0)
    else:
        print("ONE OR MORE CHECKS FAILED LOUDLY.")
        sys.exit(1)

if __name__ == "__main__":
    run_checks()
