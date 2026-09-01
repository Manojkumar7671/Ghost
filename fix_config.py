with open("scripts/diagnose_gondolin.py", "r") as f:
    lines = f.read()
import re
lines = re.sub(r'config = LitellmModelConfig\(.*\)', 'config = LitellmModelConfig(model_name="nvidia_nim/meta/llama3-70b-instruct", model_kwargs={"api_key": os.environ.get("NVIDIA_API_KEY")})', lines)
with open("scripts/diagnose_gondolin.py", "w") as f:
    f.write(lines)
