import litellm
import os

env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                try:
                    key, val = line.strip().split('=', 1)
                    os.environ[key] = val.strip('"\'')
                except:
                    pass

for m in ["groq/llama-3.3-70b-versatile", "groq/llama-3.1-8b-instant", "groq/mixtral-8x7b-32768", "groq/openai/gpt-oss-120b"]:
    try:
        res = litellm.completion(model=m, messages=[{"role": "user", "content": "hi"}], max_tokens=5)
        print(f"{m}: OK")
    except Exception as e:
        print(f"{m}: FAILED - {e}")
