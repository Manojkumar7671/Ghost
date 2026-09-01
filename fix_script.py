with open("scripts/diagnose_gondolin.py", "r") as f:
    lines = f.readlines()
with open("scripts/diagnose_gondolin.py", "w") as f:
    for line in lines:
        if "os.environ[key]" in line:
            f.write(line)
            f.write("            if key == 'NVIDIA_API_KEY': os.environ['NVIDIA_NIM_API_KEY'] = val.strip('\"\\'')\n")
        elif "model_name=" in line:
            f.write('    config = LitellmModelConfig(model_name="nvidia_nim/meta/llama3-70b-instruct")\n')
        else:
            f.write(line)
