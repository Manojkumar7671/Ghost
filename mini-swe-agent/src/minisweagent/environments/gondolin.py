import os
import platform
import re
import subprocess
from typing import Any

from pydantic import BaseModel

from minisweagent.exceptions import Submitted
from minisweagent.utils.serialize import recursive_merge

import logging

class GondolinEnvironmentConfig(BaseModel):
    cwd: str = ""
    env: dict[str, str] = {}
    timeout: int = 30
    gondolin_cli: str = "/Users/manojkumarmathangi/.pi/agent/extensions/gondolin/node_modules/@earendil-works/gondolin/dist/bin/gondolin.js"

class GondolinEnvironment:
    def __init__(self, *, config_class: type = GondolinEnvironmentConfig, **kwargs):
        print("!!! GONDOLIN ENVIRONMENT INIT CALLED !!!", flush=True)
        logging.getLogger("minisweagent.environment").info("!!! GONDOLIN ENVIRONMENT INIT CALLED !!!")
        self.config = config_class(**kwargs)
        if not self.config.cwd:
            self.config.cwd = os.getcwd()

    def get_template_vars(self, **kwargs) -> dict[str, Any]:
        return recursive_merge(self.config.model_dump(), platform.uname()._asdict(), os.environ, kwargs)

    def serialize(self) -> dict:
        return {
            "info": {
                "config": {
                    "environment": self.config.model_dump(mode="json"),
                    "environment_type": f"{self.__class__.__module__}.{self.__class__.__name__}",
                }
            }
        }

    def execute(self, action: dict, cwd: str = "", *, timeout: int | None = None) -> dict:
        tool_name = action.get("tool_name", "run_command")
        args = action.get("args", {})
        
        exec_cwd = cwd or self.config.cwd or os.getcwd()
        sandbox_dir = os.path.join(os.path.dirname(exec_cwd), ".gondolin_sandbox_" + os.path.basename(exec_cwd))
        os.makedirs(sandbox_dir, exist_ok=True)
        
        def validate_path(p: str) -> str:
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
                command = f"mkdir -p $(dirname {shlex.quote(p)}) && echo {content_arg} > {shlex.quote(p)}"
            elif tool_name == "edit_file":
                p = validate_path(args.get("path", ""))
                command = f"sed -i '' 's/{args.get('search', '')}/{args.get('replace', '')}/g' {p}"
            elif tool_name in ["run_command", "run_tests"]:
                command = args.get("command", "")
            else:
                command = action.get("command", "")
        except ValueError as e:
            return {
                "output": "",
                "returncode": -1,
                "exception_info": str(e),
                "extra": {"exception_type": "PathEscape", "exception": str(e)}
            }
            
        wrapped_command = f"{command}\nret=$?\necho '____GHOST_CWD____'\npwd\nexit $ret"
        
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
        
        try:
            result = subprocess.run(
                gondolin_cmd,
                text=True,
                timeout=timeout or self.config.timeout,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            
            stdout = result.stdout
            returncode = result.returncode
            
            new_cwd = exec_cwd
            match = re.search(r"____GHOST_CWD____\n([^\n]+)\n?$", stdout)
            if match:
                new_cwd = match.group(1).strip()
                stdout = stdout[:match.start()].rstrip("\n")
                
            if new_cwd:
                self.config.cwd = new_cwd
                
            output = {"output": stdout, "returncode": returncode, "exception_info": ""}
        except Exception as e:
            raw_output = getattr(e, "output", None)
            raw_output = (
                raw_output.decode("utf-8", errors="replace") if isinstance(raw_output, bytes) else (raw_output or "")
            )
            output = {
                "output": raw_output,
                "returncode": -1,
                "exception_info": f"An error occurred while executing the command: {e}",
                "extra": {"exception_type": type(e).__name__, "exception": str(e)},
            }
            
        self._check_finished(output)
        return output

    def _check_finished(self, output: dict):
        lines = output.get("output", "").lstrip().splitlines(keepends=True)
        if lines and lines[0].strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" and output["returncode"] == 0:
            submission = "".join(lines[1:])
            raise Submitted(
                {
                    "role": "exit",
                    "content": submission,
                    "extra": {"exit_status": "Submitted", "submission": submission},
                }
            )
