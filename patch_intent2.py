import sys

with open('server.js', 'r') as f:
    code = f.read()

target = "const { callGroq } = await import('./src/tools/llm.js');\n                    const intentRes = await callGroq(["
replace = "const { callLLM } = await import('./src/tools/llm.js');\n                    const intentRes = await callLLM(["

if target in code:
    code = code.replace(target, replace)
    with open('server.js', 'w') as f:
        f.write(code)
    print("Patched intent classification with callLLM!")
else:
    print("Target not found!")
