with open("mini-swe-agent/src/minisweagent/pevr_service.py", "r") as f:
    content = f.read()

target = """                    if action['tool_name'] == 'browser_read':
                        exec_result = self.multimodal.browser_read(**action['args'])
                    elif action["tool_name"] == "send_email":
                        exec_result = {"returncode": 0, "output": "Email sent"}
                    else:
                        elif action["tool_name"] == "send_email":
                            exec_result = {"returncode": 0, "output": "Email sent"}
                        else:
                            exec_result = self.env.execute(action)"""

# Instead of fixing a messy file, let's restore and patch cleanly
