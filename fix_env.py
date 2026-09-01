with open("scripts/milestone2_pevr.py", "r") as f:
    text = f.read()

env_loader = """
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                try:
                    key, val = line.strip().split('=', 1)
                    os.environ[key] = val.strip('"\\'')
                except:
                    pass
if 'NVIDIA_API_KEY' in os.environ:
    os.environ['GROQ_API_KEY'] = os.environ['NVIDIA_API_KEY']
"""

text = text.replace("import litellm\n", "import litellm\n" + env_loader + "\n")
with open("scripts/milestone2_pevr.py", "w") as f:
    f.write(text)
