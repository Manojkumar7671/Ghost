import os
import secrets
import re

env_file = ".env"

with open(env_file, 'r') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if '=' not in line:
        new_lines.append(line)
        continue
    
    key, val = line.split('=', 1)
    val = val.strip()
    
    # Generate new random hex for certain local keys
    if key in ['JWT_SECRET', 'N8N_ENCRYPTION_KEY']:
        new_val = secrets.token_hex(32)
        new_lines.append(f"{key}={new_val}\n")
    elif key == 'ADMIN_PASSPHRASE':
        new_val = secrets.token_urlsafe(16)
        new_lines.append(f"{key}={new_val}\n")
    elif key == 'N8N_MCP_TOKEN':
        new_val = "ghost-webhook-" + secrets.token_hex(8)
        new_lines.append(f"{key}={new_val}\n")
    # For external APIs, just append _ROTATED to invalidate them locally so the user HAS to replace them
    elif key in ['GROQ_API_KEY', 'GITHUB_TOKEN', 'NOTION_TOKEN', 'NOTION_API_KEY', 'SERPER_API_KEY', 
                 'RENDER_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_ANON_KEY', 'TAVILY_API_KEY', 
                 'META_API_KEY', 'NVIDIA_API_KEY', 'BROWSERBASE_API_KEY', 'NVIDIA_NEMOTRON_API_KEY', 
                 'OBSIDIAN_API_KEY', 'GOOGLE_CLIENT_SECRET', 'FISH_API_KEY', 'SERPAPI_KEY']:
        if val and not val.endswith("_ROTATED"):
            new_lines.append(f"{key}={val}_ROTATED\n")
        else:
            new_lines.append(line)
    elif key in ['SUPABASE_DB_URL', 'AGENT_TEST_DATABASE_URL']:
        # Replace password in postgres url with ROTATED_PASSWORD
        new_val = re.sub(r':([^:@]+)@', ':ROTATED_PASSWORD@', val)
        new_lines.append(f"{key}={new_val}\n")
    else:
        new_lines.append(line)

with open(env_file, 'w') as f:
    f.writelines(new_lines)

print("Secrets rotated locally.")
