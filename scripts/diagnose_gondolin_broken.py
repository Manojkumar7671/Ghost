import os
import sys
import subprocess
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'mini-swe-agent', 'src'))

from minisweagent.environments.gondolin import GondolinEnvironment, GondolinEnvironmentConfig

def run_checks():
    print("=== CHECK 1: Environment Identity ===")
    # BROKEN CONFIG: force local fallback by changing config
    # Actually, we can just instantiate with an invalid CLI path to break it
    env = GondolinEnvironment(gondolin_cli="/invalid/path/gondolin.js")
    class_name = env.__class__.__name__
    print(f"Instantiated class: {class_name}")
    if class_name != "GondolinEnvironment":
        print(f"FAIL: Class name is not GondolinEnvironment, it's {class_name}")
        sys.exit(1)
    
    print("\n=== CHECK 2: Real Write Path ===")
    test_file = "/tmp/gondolin_diagnostic_test.txt"
    test_content = "gondolin_write_test"
    
    result = env.execute({"command": f"echo '{test_content}' > {test_file}"})
    print(f"Agent write result returncode: {result['returncode']}")
    if result["returncode"] != 0:
        print(f"FAIL: Could not write to Gondolin environment! Output: {result['output']}")
        sys.exit(1)

    print("\nALL CHECKS PASSED.")

if __name__ == "__main__":
    run_checks()
