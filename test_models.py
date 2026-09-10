import requests
import json

models = ["cydonia-24b-v4.3", "skyfall-31b-v4.2", "llama-3-stheno-8b-v3.2", "mini-magnum-12b-v1.1"]
for m in models:
    try:
        res = requests.post("https://freellmapi-e17x.onrender.com/v1/chat/completions",
            headers={"Authorization": "Bearer free", "Content-Type": "application/json"},
            json={
                "model": m,
                "messages": [{"role": "user", "content": "hi"}],
                "tools": [{"type": "function", "function": {"name": "run_command", "description": "run", "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}}}}}]
            }
        )
        print(f"{m}: {res.status_code}")
        if res.status_code != 200:
            print(res.json())
    except Exception as e:
        print(f"{m}: Error {e}")
