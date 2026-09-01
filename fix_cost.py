with open("scripts/diagnose_gondolin.py", "r") as f:
    lines = f.read()

lines = lines.replace("os.environ[key] = val.strip('\"\\'')", "os.environ[key] = val.strip('\"\\'')\n            os.environ['MSWEA_COST_TRACKING'] = 'ignore_errors'")

with open("scripts/diagnose_gondolin.py", "w") as f:
    f.write(lines)
