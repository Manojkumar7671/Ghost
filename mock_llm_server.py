from http.server import BaseHTTPRequestHandler, HTTPServer
import json, sys

call_counts = {}

class MockLLM(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data)
        messages = data.get('messages', [])
        msgs_str = str(messages)
        model = data.get('model', 'unknown')

        # Log every inbound request so we can trace model name
        print(f"[MOCK] model={model} msgs={len(messages)}", flush=True)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

        # Task 1
        if "stress1.txt" in msgs_str:
            resp = {
                "id": "chatcmpl-1",
                "choices": [{"finish_reason": "tool_calls", "message": {
                    "role": "assistant", "content": None,
                    "tool_calls": [{"id": "call_1", "type": "function", "function": {
                        "name": "write_file",
                        "arguments": '{"path": "stress1.txt", "content": "test one"}'
                    }}]
                }}]
            }

        # Task 2
        elif "stress2.txt" in msgs_str:
            resp = {
                "id": "chatcmpl-2",
                "choices": [{"finish_reason": "tool_calls", "message": {
                    "role": "assistant", "content": None,
                    "tool_calls": [{"id": "call_2", "type": "function", "function": {
                        "name": "run_command",
                        "arguments": '{"command": "echo $(date) > stress2.txt"}'
                    }}]
                }}]
            }

        # Task 3
        elif "stress3.txt" in msgs_str:
            global call_counts
            call_counts["stress3"] = call_counts.get("stress3", 0) + 1
            if call_counts["stress3"] == 1:
                resp = {
                    "id": "chatcmpl-3",
                    "choices": [{"finish_reason": "tool_calls", "message": {
                        "role": "assistant", "content": None,
                        "tool_calls": [{"id": "call_3", "type": "function", "function": {
                            "name": "run_command",
                            "arguments": '{"command": "mkdir -p stress_dir"}'
                        }}]
                    }}]
                }
            elif call_counts["stress3"] == 2:
                resp = {
                    "id": "chatcmpl-4",
                    "choices": [{"finish_reason": "tool_calls", "message": {
                        "role": "assistant", "content": None,
                        "tool_calls": [{"id": "call_4", "type": "function", "function": {
                            "name": "write_file",
                            "arguments": '{"path": "stress_dir/stress3.txt", "content": "nested"}'
                        }}]
                    }}]
                }
            else:
                resp = {
                    "id": "chatcmpl-stop-3",
                    "choices": [{"finish_reason": "stop", "message": {
                        "role": "assistant",
                        "content": "Finished creating nested file."
                    }}]
                }

        # Task 4
        elif "does_not_exist.txt" in msgs_str:
            call_counts["fail_test"] = call_counts.get("fail_test", 0) + 1
            has_error = any("No such file" in str(m) for m in messages)
            if not has_error and call_counts["fail_test"] == 1:
                resp = {
                    "id": "chatcmpl-5",
                    "choices": [{"finish_reason": "tool_calls", "message": {
                        "role": "assistant", "content": None,
                        "tool_calls": [{"id": "call_5", "type": "function", "function": {
                            "name": "read_file",
                            "arguments": '{"path": "does_not_exist.txt"}'
                        }}]
                    }}]
                }
            else:
                resp = {
                    "id": "chatcmpl-6",
                    "choices": [{"finish_reason": "stop", "message": {
                        "role": "assistant",
                        "content": "I tried to read the file, but it doesn't exist. Failing cleanly."
                    }}]
                }

        # ESCALATION TEST: escalate_task keyword
        # Executor calls 1+2: always malformed (bad JSON) → triggers cumulative malformed >= 2
        # Executor call 3+ (strong tier after escalation): valid write_file
        # Planner calls (model=gpt-oss-120b, no tools) are NOT counted here
        elif "escalate_task" in msgs_str:
            is_planner_call = not data.get('tools')  # planner sends no tools
            if is_planner_call:
                # Return a valid plan for the planner
                resp = {
                    "id": "chatcmpl-plan",
                    "choices": [{"finish_reason": "stop", "message": {
                        "role": "assistant",
                        "content": json.dumps({
                            "steps": [{
                                "step_id": "s1",
                                "objective": "escalate_task: write a file called escalation_result.txt with content written after escalation to strong tier",
                                "permitted_tools": ["run_command", "write_file", "read_file", "browser_read"],
                                "verification_method": {"type": "run_command", "command": "echo ok"},
                                "retry_budget": 3,
                                "dependencies": []
                            }]
                        })
                    }}]
                }
                print(f"[MOCK] PLANNER call model={model} → returning plan", flush=True)
            else:
                # Executor call — count these separately
                call_counts["escalate_exec"] = call_counts.get("escalate_exec", 0) + 1
                n = call_counts["escalate_exec"]
                print(f"[MOCK] EXECUTOR escalate call #{n} model={model}", flush=True)
                if n <= 2:
                    # Malformed — unparseable JSON arguments
                    resp = {
                        "id": f"chatcmpl-escalate-mal-{n}",
                        "choices": [{"finish_reason": "tool_calls", "message": {
                            "role": "assistant", "content": None,
                            "tool_calls": [{"id": f"call_mal_{n}", "type": "function", "function": {
                                "name": "write_file",
                                "arguments": "{INVALID JSON THIS IS MALFORMED}"
                            }}]
                        }}]
                    }
                elif n == 3:
                    # Strong tier: valid call — this fires after escalation
                    resp = {
                        "id": "chatcmpl-escalate-strong",
                        "choices": [{"finish_reason": "tool_calls", "message": {
                            "role": "assistant", "content": None,
                            "tool_calls": [{"id": "call_strong_1", "type": "function", "function": {
                                "name": "write_file",
                                "arguments": '{"path": "escalation_result.txt", "content": "written after escalation to strong tier"}'
                            }}]
                        }}]
                    }
                else:
                    # Stop after the strong tier has done its job
                    resp = {
                        "id": "chatcmpl-escalate-stop",
                        "choices": [{"finish_reason": "stop", "message": {
                            "role": "assistant",
                            "content": "Finished writing the file after escalation."
                        }}]
                    }

        else:
            resp = {
                "id": "chatcmpl-stop",
                "choices": [{"finish_reason": "stop", "message": {
                    "role": "assistant",
                    "content": "Finished task."
                }}]
            }

        self.wfile.write(json.dumps(resp).encode('utf-8'))

    def log_message(self, format, *args):
        pass  # suppress default httpd noise; we use print above

if __name__ == '__main__':
    print("[MOCK] Starting mock LLM server on port 3005", flush=True)
    server = HTTPServer(('localhost', 3005), MockLLM)
    server.serve_forever()
