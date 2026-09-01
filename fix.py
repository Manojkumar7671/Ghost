with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "r") as f:
    text = f.read()
import re
text = re.sub(r'wrapped_command = f"\{command\}[\s\S]*?exit \$ret"\nret=\$\?[\s\S]*?exit \$ret"', 'wrapped_command = f"{command}\\nret=$?\\necho \\\'____GHOST_CWD____\\\'\\npwd\\nexit $ret"', text)
with open("mini-swe-agent/src/minisweagent/environments/gondolin.py", "w") as f:
    f.write(text)
