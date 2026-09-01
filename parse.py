import urllib.request
import re

url = "https://mini-swe-agent.com/latest/advanced/v2_migration/"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    # strip html tags
    text = re.sub(r'<[^>]+>', '\n', html)
    text = re.sub(r'\n\s*\n', '\n', text)
    print(text[:2000])
    for line in text.split('\n'):
        if 'json' in line.lower() or 'stdout' in line.lower() or 'format' in line.lower():
            print(line)
except Exception as e:
    print("Error:", e)
