import re
with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "r") as f:
    text = f.read()

# find wrapped_command = f"{command}... exit $ret" which was broken into multiple lines
text = re.sub(r'wrapped_command = f"\{command\}[\s\S]*?exit \$ret"', 'wrapped_command = f"{command}\\nret=$?\\necho \'____GHOST_CWD____\'\\npwd\\nexit $ret"', text)

with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "w") as f:
    f.write(text)
