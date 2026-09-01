with open("scripts/diagnose_gondolin.py", "r") as f:
    lines = f.read()

import re
sandbox_mount = 'f"{os.path.join(os.path.dirname(env.config.cwd), \'.gondolin_sandbox_\' + os.path.basename(env.config.cwd))}:{env.config.cwd}"'

old_indep = '''indep_result = subprocess.run([
            "node", gondolin_cli, "exec", "--", "cat", test_file_vm_path
        ]'''

new_indep = f'''indep_result = subprocess.run([
            "node", gondolin_cli, "exec", "--mount-hostfs", {sandbox_mount}, "--", "cat", test_file_vm_path
        ]'''

lines = lines.replace(old_indep, new_indep)

with open("scripts/diagnose_gondolin.py", "w") as f:
    f.write(lines)
