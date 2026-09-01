import re

with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "r") as f:
    text = f.read()

# I will cleanly remove the duplicate blocks.
text = re.sub(r'        try:\n            command = ""\n            if tool_name == "list_files":.*?wrapped_command = f"{command}\\nret=\$\?\\necho \'____GHOST_CWD____\'\\npwd\\nexit \$ret"\n\n            "exec",\n            "--mount-hostfs",\n            f"{sandbox_dir}:{exec_cwd}",\n            "--cwd",\n            exec_cwd,\n            "--",\n            "sh",\n            "-c",\n            wrapped_command\n        ]\n        \n        try:', '        try:', text, flags=re.DOTALL)

with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "w") as f:
    f.write(text)
