import re

with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "r") as f:
    content = f.read()

new_exec = """
    def execute(self, action: dict, cwd: str = "", *, timeout: int | None = None) -> dict:
        tool_name = action.get("tool_name", "run_command")
        args = action.get("args", {})
        
        exec_cwd = cwd or self.config.cwd or os.getcwd()
        sandbox_dir = os.path.join(os.path.dirname(exec_cwd), ".gondolin_sandbox_" + os.path.basename(exec_cwd))
        os.makedirs(sandbox_dir, exist_ok=True)
        
        # Path validation logic
        def validate_path(p: str) -> str:
            # resolve against exec_cwd (sandbox workspace root)
            abs_p = os.path.abspath(os.path.join(exec_cwd, p))
            if not abs_p.startswith(os.path.abspath(exec_cwd)):
                raise ValueError(f"Path escape detected! '{p}' resolves outside the sandbox workspace.")
            return abs_p
            
        try:
            command = ""
            if tool_name == "list_files":
                p = validate_path(args.get("path", "."))
                command = f"ls -la {p}"
            elif tool_name == "read_file":
                p = validate_path(args.get("path", ""))
                command = f"cat {p}"
            elif tool_name == "write_file":
                p = validate_path(args.get("path", ""))
                import shlex
                content_arg = shlex.quote(args.get("content", ""))
                command = f"echo {content_arg} > {p}"
            elif tool_name == "edit_file":
                p = validate_path(args.get("path", ""))
                command = f"sed -i '' 's/{args.get('search', '')}/{args.get('replace', '')}/g' {p}"
            elif tool_name in ["run_command", "run_tests"]:
                # Assume commands don't take raw paths to validate in Python, we rely on VM isolation + hostfs mapping
                command = args.get("command", "")
            else:
                # Fallback for old agent format where action has just 'command'
                command = action.get("command", "")
                
        except ValueError as e:
            return {
                "output": "",
                "returncode": -1,
                "exception_info": str(e),
                "extra": {"exception_type": "PathEscape", "exception": str(e)}
            }
            
        wrapped_command = f"{command}\\nret=$?\\necho '____GHOST_CWD____'\\npwd\\nexit $ret"
        
        gondolin_cmd = [
            "node",
            self.config.gondolin_cli,
            "exec",
            "--mount-hostfs",
            f"{sandbox_dir}:{exec_cwd}",
            "--cwd",
            exec_cwd,
            "--",
            "sh",
            "-c",
            wrapped_command
        ]
"""

content = re.sub(r'def execute\(self.*?gondolin_cmd = \[[^]]+\]', new_exec.strip(), content, flags=re.DOTALL)

with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "w") as f:
    f.write(content)
