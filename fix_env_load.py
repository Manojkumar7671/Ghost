with open("scripts/diagnose_gondolin.py", "r") as f:
    lines = f.read()

lines = lines.replace("""            if key == 'NVIDIA_API_KEY':
                os.environ['GROQ_API_KEY'] = val.strip('"\\'')""", "")

with open("scripts/diagnose_gondolin.py", "w") as f:
    f.write(lines)
