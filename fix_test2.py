with open("scripts/milestone3_gateway.py", "r") as f:
    content = f.read()
import re
new_test2 = """
    elif test_mode == "probe_fail":
        print("\\n--- TEST 2: CAPABILITY PROBE ON MODEL WITHOUT TOOL SUPPORT ---")
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
"""

content = re.sub(r'    elif test_mode == "probe_fail":.*?except Exception as e:\n            print\(f"Fallback mode failed: \{e\}"\)', new_test2.strip('\n'), content, flags=re.DOTALL)
with open("scripts/milestone3_gateway.py", "w") as f:
    f.write(content)
