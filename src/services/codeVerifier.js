const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Parses measurable constraints from the user prompt.
 * Constraints include:
 * - maxLines: e.g. "50-line", "within 50 lines", "max 50 lines", "under 50 lines"
 * - exactLines: e.g. "exactly 50 lines"
 * - language: python, javascript, node, etc.
 * - requiredLibraries: e.g. pydantic, bs4, requests
 * - forbiddenLibraries: e.g. no numpy, without requests
 * - noNetwork: boolean
 */
function parseConstraints(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return {
      maxLines: null,
      exactLines: null,
      language: 'python',
      requiredLibraries: [],
      forbiddenLibraries: [],
      noNetwork: false
    };
  }

  const text = prompt.trim();
  const lower = text.toLowerCase();

  // 1. Language detection
  let language = 'python';
  if (/\b(javascript|js|node(?:js)?|express)\b/i.test(lower)) {
    language = 'javascript';
  } else if (/\b(typescript|ts)\b/i.test(lower)) {
    language = 'typescript';
  } else if (/\b(bash|sh|shell)\b/i.test(lower)) {
    language = 'bash';
  } else if (/\b(python|py|pydantic|flask|django|fastapi)\b/i.test(lower)) {
    language = 'python';
  }

  // 2. Line count constraints
  let maxLines = null;
  let exactLines = null;

  const exactMatch = lower.match(/\bexactly\s+(\d+)\s+lines?\b/i);
  if (exactMatch) {
    exactLines = parseInt(exactMatch[1], 10);
  } else {
    const linePattern1 = /\b(\d+)\s*-?\s*lines?\s+(?:python\s+|javascript\s+|js\s+|node\s+)?(?:script|code|program|function|scraper|app)\b/i;
    const linePattern2 = /\b(?:within|under|max|maximum|at\s+most|less\s+than|in)\s+(\d+)\s+lines?\b/i;
    const linePattern3 = /\b(?:limit\s+of|line\s+limit:?)\s*(\d+)\b/i;

    const m1 = lower.match(linePattern1);
    const m2 = lower.match(linePattern2);
    const m3 = lower.match(linePattern3);

    if (m1) maxLines = parseInt(m1[1], 10);
    else if (m2) maxLines = parseInt(m2[1], 10);
    else if (m3) maxLines = parseInt(m3[1], 10);
  }

  // 3. Required libraries
  const requiredLibraries = [];
  if (/\bpydantic\b/i.test(lower)) {
    requiredLibraries.push('pydantic');
  }
  if (/\b(?:beautifulsoup|bs4)\b/i.test(lower)) {
    requiredLibraries.push('bs4');
  }
  if (/\bpandas\b/i.test(lower)) {
    requiredLibraries.push('pandas');
  }
  if (/\bnumpy\b/i.test(lower)) {
    requiredLibraries.push('numpy');
  }
  if (/\brequests\b/i.test(lower)) {
    requiredLibraries.push('requests');
  }

  // 4. Forbidden libraries
  const forbiddenLibraries = [];
  const forbidMatch = lower.match(/\b(?:no|without|avoid|forbidden)\s+([a-zA-Z0-9_\-]+)\b/i);
  if (forbidMatch) {
    const lib = forbidMatch[1].toLowerCase();
    if (!['network', 'internet', 'error', 'errors', 'comments', 'docstring', 'filler'].includes(lib)) {
      forbiddenLibraries.push(lib);
    }
  }

  // 5. Network constraint
  const noNetwork = /\b(no\s+network|offline|without\s+internet|no\s+external\s+calls)\b/i.test(lower);

  return {
    maxLines,
    exactLines,
    language,
    requiredLibraries,
    forbiddenLibraries,
    noNetwork
  };
}

/**
 * Counts non-blank, non-comment lines of code.
 * Accurately ignores single-line and multiline docstrings and comments.
 */
function countCodeLines(code, language = 'python') {
  if (!code || typeof code !== 'string') return 0;
  const lines = code.split('\n');
  let count = 0;

  if (language === 'python') {
    let inDocstring = false;
    let docChar = '';

    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      if (!inDocstring) {
        if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
          const marker = trimmed.slice(0, 3);
          const rest = trimmed.slice(3);
          if (rest.includes(marker)) {
            // Single-line docstring
            continue;
          }
          inDocstring = true;
          docChar = marker;
          continue;
        }
        if (trimmed.startsWith('#')) continue;
        count++;
      } else {
        if (trimmed.includes(docChar)) {
          inDocstring = false;
        }
        continue;
      }
    }
  } else {
    // JavaScript / Node / TypeScript
    let inBlockComment = false;

    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      if (!inBlockComment) {
        if (trimmed.startsWith('/*')) {
          if (trimmed.includes('*/')) continue;
          inBlockComment = true;
          continue;
        }
        if (trimmed.startsWith('//')) continue;
        count++;
      } else {
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }
    }
  }

  return count;
}

/**
 * Extracts top-level module imports.
 */
function extractImports(code, language = 'python') {
  if (!code || typeof code !== 'string') return [];
  const imports = new Set();
  const lines = code.split('\n');

  if (language === 'python') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) continue;

      const fromMatch = trimmed.match(/^from\s+([a-zA-Z0-9_\.]+)\s+import/);
      if (fromMatch) {
        const top = fromMatch[1].split('.')[0];
        if (top) imports.add(top);
        continue;
      }

      const importMatch = trimmed.match(/^import\s+([^#]+)/);
      if (importMatch) {
        const parts = importMatch[1].split(',');
        for (const p of parts) {
          const mod = p.trim().split(/\s+as\s+/)[0].trim().split('.')[0];
          if (mod) imports.add(mod);
        }
      }
    }
  } else {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue;

      const esmMatch = trimmed.match(/(?:^|\s)import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (esmMatch) {
        const mod = esmMatch[1].replace(/^\.\//, '').split('/')[0];
        imports.add(mod);
      }

      const cjsMatch = trimmed.match(/(?:^|\s)require\(['"]([^'"]+)['"]\)/);
      if (cjsMatch) {
        const mod = cjsMatch[1].replace(/^\.\//, '').split('/')[0];
        imports.add(mod);
      }
    }
  }

  return Array.from(imports);
}

/**
 * Programmatic syntax check using py_compile or node --check.
 */
function checkSyntax(code, language = 'python', scratchDir = null) {
  const dir = scratchDir || path.resolve(process.cwd(), 'scratch');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ext = language === 'python' ? '.py' : '.js';
  const tempFile = path.join(dir, `_syntax_check_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  try {
    fs.writeFileSync(tempFile, code, 'utf-8');

    if (language === 'python') {
      execSync(`python3 -m py_compile "${tempFile}"`, {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return { passed: true, tool: 'py_compile' };
    } else {
      execSync(`node --check "${tempFile}"`, {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return { passed: true, tool: 'node --check' };
    }
  } catch (err) {
    const rawStderr = err.stderr ? err.stderr.toString().trim() : (err.message || 'Syntax error');
    const cleanedStderr = rawStderr.split(tempFile).join('script.py').trim();
    const lineMatch = cleanedStderr.match(/line\s+(\d+)/i);
    const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : null;
    return {
      passed: false,
      tool: language === 'python' ? 'py_compile' : 'node --check',
      line: lineNum,
      error: cleanedStderr || 'Syntax error'
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
  }
}

/**
 * Static linter check using pyflakes and AST inspection for unused variables and parameters.
 */
function checkLinter(code, language = 'python', scratchDir = null) {
  if (language !== 'python') {
    return { passed: true, tool: 'linter', issues: [] };
  }

  const dir = scratchDir || path.resolve(process.cwd(), 'scratch');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempFile = path.join(dir, `_linter_check_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

  try {
    fs.writeFileSync(tempFile, code, 'utf-8');

    // Run unified python runner checking pyflakes + AST unused parameters
    const linterScript = `
import ast, sys, subprocess, json

def run_checks(code_file):
    issues = []
    # 1. pyflakes check for undefined names, unused imports, and unused local variables
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pyflakes", code_file],
            capture_output=True,
            text=True,
            timeout=5
        )
        combined = (proc.stdout or "") + (proc.stderr or "")
        for line in combined.strip().splitlines():
            clean = line.replace(code_file, "script.py").strip()
            if clean:
                issues.append(clean)
    except Exception as e:
        issues.append(f"pyflakes execution error: {str(e)}")

    # 2. AST unused function parameter check
    try:
        with open(code_file, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name.startswith("__") and node.name.endswith("__"):
                    continue
                arg_names = [arg.arg for arg in node.args.args if arg.arg not in ("self", "cls", "_")]
                used = {child.id for child in ast.walk(node) if isinstance(child, ast.Name) and not isinstance(child.ctx, ast.Param)}
                for arg in arg_names:
                    if arg not in used:
                        issues.append(f"Function '{node.name}' has unused parameter '{arg}' (line {node.lineno})")
    except Exception as e:
        issues.append(f"AST check error: {str(e)}")

    print(json.dumps({"passed": len(issues) == 0, "issues": issues}))

run_checks(sys.argv[1])
`;

    const outJson = execSync(`python3 -c '${linterScript.replace(/'/g, "'\\''")}' "${tempFile}"`, {
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString().trim();

    const parsed = JSON.parse(outJson);
    return {
      passed: parsed.passed,
      tool: 'pyflakes & AST linter',
      issues: parsed.issues || [],
      error: (parsed.issues && parsed.issues[0]) || null
    };
  } catch (err) {
    const errMsg = err.stderr ? err.stderr.toString().trim() : err.message;
    return {
      passed: false,
      tool: 'pyflakes & AST linter',
      issues: [errMsg],
      error: errMsg
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
  }
}

/**
 * Executes the code either directly (if purely local) or under a mocked-network
 * harness (if it requires external network/APIs/keys) with a 10s timeout.
 */
function checkExecution(code, language = 'python', scratchDir = null) {
  if (!code || typeof code !== 'string') {
    return { executed: false, mode: 'none', reason: 'Empty code' };
  }

  const needsNetwork = /\b(urllib\.request|requests\.|httpx\.|aiohttp\.|fetch\(|https?:\/\/|http\.client|socket\b)/i.test(code);
  const needsKeys = /\b(os\.environ|os\.getenv|process\.env|api[_-]?key|secret|auth_token)\b/i.test(code);
  const needsInput = /\b(input\(|stdin\.read|readline\()/i.test(code);

  if (needsInput) {
    return {
      executed: false,
      mode: 'none',
      reason: 'requires interactive stdin user input'
    };
  }

  const dir = scratchDir || path.resolve(process.cwd(), 'scratch');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ext = language === 'python' ? '.py' : '.js';
  const tempFile = path.join(dir, `_exec_run_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  try {
    fs.writeFileSync(tempFile, code, 'utf-8');

    if (!needsNetwork && !needsKeys) {
      // Pure local execution without network or API key dependencies
      const cmd = language === 'python' ? `python3 "${tempFile}"` : `node "${tempFile}"`;
      const stdout = execSync(cmd, {
        cwd: dir,
        timeout: 10000,
        env: { ...process.env, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe']
      }).toString();

      return {
        executed: true,
        mode: 'local_scratch',
        exitCode: 0,
        stdout: stdout.trim().slice(0, 300),
        passed: true
      };
    }

    // Code requires network/API keys: execute under local mock-network harness
    if (language === 'python') {
      const mockHarness = `
import sys, os, json, warnings
from io import BytesIO

# Suppress OpenSSL / urllib3 / Pydantic deprecation warnings in stdout/stderr during test runs
warnings.filterwarnings('ignore')

# Preload dummy environment keys for testing
os.environ.setdefault('OPENAI_API_KEY', 'sk-mock-ghost-test-key-12345')
os.environ.setdefault('ANTHROPIC_API_KEY', 'sk-mock-anthropic-test-key')
os.environ.setdefault('API_KEY', 'sk-mock-key')

SAMPLE_QUOTES_HTML = """<!DOCTYPE html><html><body>
<div class="quote">
    <span class="text">Life is what happens when you are busy making other plans.</span>
    <small class="author">John Lennon</small>
    <a class="tag">life</a>
    <a class="tag">inspirational</a>
</div>
<div class="quote">
    <span class="text">The journey of a thousand miles begins with one step.</span>
    <small class="author">Lao Tzu</small>
    <a class="tag">wisdom</a>
</div>
</body></html>"""

quote_item_1 = {
    "quote": "Life is what happens when you are busy making other plans.",
    "text": "Life is what happens when you are busy making other plans.",
    "author": "John Lennon",
    "tags": ["life", "inspirational"]
}
quote_item_2 = {
    "quote": "The journey of a thousand miles begins with one step.",
    "text": "The journey of a thousand miles begins with one step.",
    "author": "Lao Tzu",
    "tags": ["wisdom"]
}

SAMPLE_QUOTE_DATA = {
    "quotes": [quote_item_1, quote_item_2],
    "items": [quote_item_1, quote_item_2],
    "data": [quote_item_1, quote_item_2],
    "results": [quote_item_1, quote_item_2],
    "top_quote": quote_item_1,
    "quote": "Life is what happens when you are busy making other plans.",
    "text": "Life is what happens when you are busy making other plans.",
    "author": "John Lennon",
    "tags": ["life", "inspirational"],
    "tag": "life",
    "total": 2,
    "count": 2,
    "completion": "Life is what happens when you are busy making other plans. - John Lennon"
}

SAMPLE_QUOTE_JSON = json.dumps(SAMPLE_QUOTE_DATA)

class MockHTTPResponse:
    def __init__(self, data_dict_or_text, status_code=200):
        if isinstance(data_dict_or_text, dict):
            self._json_data = data_dict_or_text
            self.text = json.dumps(data_dict_or_text)
        else:
            self.text = str(data_dict_or_text)
            try:
                self._json_data = json.loads(self.text)
            except:
                self._json_data = {}
        self.status_code = status_code
        self.content = self.text.encode('utf-8')
    def json(self):
        return self._json_data
    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code} Error")

def mock_get(url, *args, **kwargs):
    return MockHTTPResponse(SAMPLE_QUOTES_HTML)

def mock_post(url, *args, **kwargs):
    headers = kwargs.get('headers') or {}
    auth_header = str(headers.get('Authorization') or headers.get('authorization') or '')
    auth_arg = kwargs.get('auth')
    # Validate Bearer auth for OpenAI
    if 'api.openai.com' in str(url):
        if auth_arg is not None:
            raise ValueError("OpenAI API requires 'Authorization: Bearer <token>' header, not HTTP Basic Auth (auth=...)")
        if auth_header and not auth_header.startswith('Bearer '):
            raise ValueError(f"OpenAI API requires Bearer authentication, got: {auth_header[:15]}")

    json_payload = kwargs.get('json') or {}
    if not json_payload and kwargs.get('data'):
        try:
            json_payload = json.loads(kwargs.get('data'))
        except:
            pass

    model_name = str(json_payload.get('model') or '')
    url_str = str(url)

    # Respond by endpoint path in real OpenAI formats only (no top-level text/author/quote fields)
    if '/v1/chat/completions' in url_str:
        return MockHTTPResponse({
            'id': 'chatcmpl-mock',
            'object': 'chat.completion',
            'created': 1700000000,
            'model': model_name or 'gpt-4o-mini',
            'choices': [
                {
                    'index': 0,
                    'message': {
                        'role': 'assistant',
                        'content': SAMPLE_QUOTE_JSON
                    },
                    'finish_reason': 'stop'
                }
            ],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 15, 'total_tokens': 25}
        })
    elif '/v1/completions' in url_str:
        # Check if caller used a chat-only model with legacy completions
        chat_models = ['gpt-4', 'gpt-3.5-turbo', 'o1', 'o3']
        if any(cm in model_name.lower() for cm in chat_models) and 'instruct' not in model_name.lower():
            raise ValueError(f"OpenAI API Error: The model '{model_name}' is not supported by /v1/completions. This is a chat model; use /v1/chat/completions instead.")
        return MockHTTPResponse({
            'id': 'cmpl-mock',
            'object': 'text_completion',
            'created': 1700000000,
            'model': model_name or 'gpt-3.5-turbo-instruct',
            'choices': [
                {
                    'index': 0,
                    'text': SAMPLE_QUOTE_JSON,
                    'finish_reason': 'stop'
                }
            ],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 15, 'total_tokens': 25}
        })
    else:
        # Generic OpenAI-compatible default
        return MockHTTPResponse({
            'id': 'mock-completion',
            'choices': [
                {
                    'message': {'role': 'assistant', 'content': SAMPLE_QUOTE_JSON},
                    'text': SAMPLE_QUOTE_JSON
                }
            ]
        })

try:
    import requests
    requests.get = mock_get
    requests.post = mock_post
    requests.Session.get = lambda self, url, *a, **kw: mock_get(url, *a, **kw)
    requests.Session.post = lambda self, url, *a, **kw: mock_post(url, *a, **kw)
except ImportError:
    pass

try:
    import urllib.request
    class MockUrllibResponse:
        def __init__(self, data_bytes): self.fp = BytesIO(data_bytes)
        def read(self, *a): return self.fp.read(*a)
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def mock_urlopen(url_or_req, *a, **kw):
        url = url_or_req.get_full_url() if hasattr(url_or_req, 'get_full_url') else str(url_or_req)
        if '/v1/chat/completions' in url:
            resp_data = {
                'id': 'chatcmpl-mock',
                'object': 'chat.completion',
                'created': 1700000000,
                'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': SAMPLE_QUOTE_JSON}, 'finish_reason': 'stop'}]
            }
            return MockUrllibResponse(json.dumps(resp_data).encode('utf-8'))
        elif '/v1/completions' in url:
            resp_data = {
                'id': 'cmpl-mock',
                'object': 'text_completion',
                'created': 1700000000,
                'choices': [{'index': 0, 'text': SAMPLE_QUOTE_JSON, 'finish_reason': 'stop'}]
            }
            return MockUrllibResponse(json.dumps(resp_data).encode('utf-8'))
        return MockUrllibResponse(SAMPLE_QUOTES_HTML.encode('utf-8'))

    urllib.request.urlopen = mock_urlopen
except ImportError:
    pass

target_script = sys.argv[1]
with open(target_script, 'r', encoding='utf-8') as f:
    script_content = f.read()

globs = {'__name__': '__main__', '__file__': target_script}
exec(compile(script_content, target_script, 'exec'), globs)
`;

      const stdout = execSync(`python3 -c '${mockHarness.replace(/'/g, "'\\''")}' "${tempFile}"`, {
        cwd: dir,
        timeout: 10000,
        env: { ...process.env, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'pipe']
      }).toString();

      return {
        executed: true,
        mode: 'mocked_network',
        exitCode: 0,
        stdout: stdout.trim().slice(0, 300),
        passed: true
      };
    } else {
      // JavaScript with network not mocked
      return {
        executed: false,
        mode: 'none',
        reason: 'JavaScript network mocking not configured for this script'
      };
    }
  } catch (err) {
    const rawStderr = err.stderr ? err.stderr.toString().trim() : (err.message || '');
    const lines = rawStderr.split('\n').map(l => l.trim()).filter(Boolean);
    const meaningfulLines = lines.filter(l =>
      !l.startsWith('For further information visit') &&
      !l.startsWith('warnings.warn') &&
      !l.startsWith('sys:1:')
    );
    const excIndex = meaningfulLines.findIndex(l => /^[A-Z][a-zA-Z0-9_]*Error:|^pydantic[._]/.test(l));
    let cleanStderr = '';
    if (excIndex !== -1) {
      cleanStderr = meaningfulLines.slice(excIndex, excIndex + 3).join(' ');
    } else {
      cleanStderr = meaningfulLines.slice(-2).join(' ') || rawStderr;
    }
    return {
      executed: true,
      mode: needsNetwork || needsKeys ? 'mocked_network' : 'local_scratch',
      exitCode: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout ? err.stdout.toString().trim().slice(0, 300) : '',
      stderr: cleanStderr.slice(0, 300),
      passed: false
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
  }
}

/**
 * Verifies code against prompt constraints.
 */
function verifyCode({ prompt, code, language = null, scratchDir = null }) {
  const constraints = parseConstraints(prompt);
  const lang = language || constraints.language;
  const lineCount = countCodeLines(code, lang);
  const imports = extractImports(code, lang);

  const failures = [];
  let checksTotal = 0;
  let checksPassed = 0;

  // 1. Line count verification
  let lineCountPassed = true;
  if (constraints.maxLines !== null) {
    checksTotal++;
    if (lineCount <= constraints.maxLines) {
      checksPassed++;
    } else {
      lineCountPassed = false;
      failures.push(`Measured line count is ${lineCount} lines (exceeds ${constraints.maxLines}-line limit)`);
    }
  } else if (constraints.exactLines !== null) {
    checksTotal++;
    if (lineCount === constraints.exactLines) {
      checksPassed++;
    } else {
      lineCountPassed = false;
      failures.push(`Measured line count is ${lineCount} lines (required exactly ${constraints.exactLines} lines)`);
    }
  }

  // 2. Required libraries
  if (constraints.requiredLibraries.length > 0) {
    for (const reqLib of constraints.requiredLibraries) {
      checksTotal++;
      if (imports.includes(reqLib)) {
        checksPassed++;
      } else {
        failures.push(`Missing required library import: ${reqLib}`);
      }
    }
  }

  // 3. Forbidden libraries
  if (constraints.forbiddenLibraries.length > 0) {
    for (const forbLib of constraints.forbiddenLibraries) {
      checksTotal++;
      if (!imports.includes(forbLib)) {
        checksPassed++;
      } else {
        failures.push(`Contains forbidden library: ${forbLib}`);
      }
    }
  }

  // 4. Syntax check (static)
  checksTotal++;
  const syntax = checkSyntax(code, lang, scratchDir);
  if (syntax.passed) {
    checksPassed++;
  } else {
    const lineInfo = syntax.line ? ` (line ${syntax.line})` : '';
    failures.push(`Syntax check failed (${syntax.tool}${lineInfo}):\n${syntax.error}`);
  }

  // 5. Linter check (static pyflakes + AST unused parameters)
  checksTotal++;
  const linter = checkLinter(code, lang, scratchDir);
  if (linter.passed) {
    checksPassed++;
  } else {
    for (const issue of (linter.issues || [])) {
      failures.push(`Static linter issue: ${issue}`);
    }
  }

  // 6. Endpoint / model compatibility check & real format parsing check
  let endpointModelValid = true;
  let responseParsingValid = true;
  const callsApi = /\b(?:https?:\/\/api\.openai\.com|completions)\b/i.test(code);
  if (callsApi) {
    const callsLegacyCompletions = /\/v1\/completions\b(?!\/chat)/.test(code);
    const callsChatCompletions = /\/v1\/chat\/completions\b/.test(code);
    const usesChatOnlyModel = /\b(gpt-4o|gpt-4o-mini|gpt-4-turbo|gpt-4(?!-instruct)|gpt-3\.5-turbo(?!-instruct)|o1|o3)\b/i.test(code);

    if (callsLegacyCompletions && !callsChatCompletions && usesChatOnlyModel) {
      endpointModelValid = false;
      checksTotal++;
      failures.push("Endpoint/model mismatch: /v1/completions does not support chat models (e.g. gpt-4o/gpt-4o-mini). Use /v1/chat/completions instead.");
    }

    if (callsChatCompletions) {
      checksTotal++;
      const parsesChatMessageContent = /choices.*?message.*?content/i.test(code);
      if (!parsesChatMessageContent) {
        responseParsingValid = false;
        failures.push("Response parsing mismatch: /v1/chat/completions response must be parsed via ['choices'][0]['message']['content'] before Pydantic validation.");
      } else {
        checksPassed++;
      }
    } else if (callsLegacyCompletions) {
      checksTotal++;
      const parsesLegacyText = /choices.*?text/i.test(code);
      if (!parsesLegacyText) {
        responseParsingValid = false;
        failures.push("Response parsing mismatch: /v1/completions response must be parsed via ['choices'][0]['text'] before Pydantic validation.");
      } else {
        checksPassed++;
      }
    }
  }

  // 7. Execution check (mocked network or local scratch)
  let execution = { executed: false, mode: 'none', reason: 'Not executed' };
  if (syntax.passed) {
    execution = checkExecution(code, lang, scratchDir);
    if (execution.executed) {
      checksTotal++;
      if (execution.passed) {
        checksPassed++;
      } else {
        failures.push(`Execution failed (${execution.mode}): ${execution.stderr || 'Non-zero exit'}`);
      }
    }
  } else {
    execution = {
      executed: false,
      mode: 'none',
      reason: 'Syntax check failed; execution skipped'
    };
  }

  // 8. Pydantic validation of LLM output check (if requested)
  let pydanticValidationPassed = false;
  let pydanticMockStatus = null;
  const hasPydanticMockCheck = constraints.requiredLibraries.includes('pydantic') && /\b(?:llm|api|completion|validated\s+json)\b/i.test(prompt);

  if (hasPydanticMockCheck) {
    const hasValidationMethod = /\b(?:model_validate_json|model_validate|parse_raw|parse_obj)\b/.test(code) ||
      /\b[A-Z]\w*\s*\(\s*(?:(?:\*\*)?(?:json\.loads)|(?:text|completion|content)\s*=)/.test(code);
    const passesRawResponseDict = /\b[A-Z]\w*\s*\(\s*\*\*(?:response|res|resp|r)\s*(?:\.json\(\))?\s*\)/.test(code);
    const staticPydanticValid = hasValidationMethod && !passesRawResponseDict && responseParsingValid;

    // Dependency check: if py_compile fails OR the mock run fails/crashes/times out,
    // the Pydantic mock check must show "N/A (execution did not complete)", never PASSED,
    // and must not count toward "Checks passed".
    if (!syntax.passed || !execution.executed || !execution.passed) {
      pydanticMockStatus = 'N/A (execution did not complete)';
      pydanticValidationPassed = false;
      if (!staticPydanticValid) {
        failures.push("LLM output is not validated into a Pydantic model (e.g. Model.model_validate_json(completion_text))");
      }
    } else {
      // Both syntax and execution completed successfully!
      checksTotal++;
      if (staticPydanticValid) {
        checksPassed++;
        pydanticValidationPassed = true;
        pydanticMockStatus = 'PASSED';
      } else {
        pydanticValidationPassed = false;
        pydanticMockStatus = 'FAILED: LLM output not validated into Pydantic model';
        if (passesRawResponseDict) {
          failures.push("Invalid Pydantic validation: Passed raw HTTP response dictionary directly to Pydantic model. Must parse choices[0].message.content into Model.model_validate_json(...) or Model(**json.loads(...)).");
        } else {
          failures.push("LLM output is not validated into a Pydantic model (e.g. Model.model_validate_json(completion_text))");
        }
      }
    }
  }

  const passed = failures.length === 0;

  return {
    passed,
    failures,
    metrics: {
      lineCount,
      maxLines: constraints.maxLines,
      exactLines: constraints.exactLines,
      lineCountPassed,
      language: lang,
      imports,
      requiredLibraries: constraints.requiredLibraries,
      endpointModelValid,
      responseParsingValid,
      hasPydanticMockCheck,
      pydanticMockStatus,
      pydanticValidationPassed,
      syntax,
      linter,
      execution,
      checksPassed,
      checksTotal
    }
  };
}

/**
 * Builds the final "Verification" markdown block containing strictly measured facts.
 * Explicitly states "Static checks only" and notes mock execution vs live endpoints.
 */
function generateVerificationBlock(metrics) {
  const lines = ['### Verification'];

  // Line count
  if (metrics.maxLines !== null) {
    const status = metrics.lineCountPassed ? 'PASSED' : `FAILED: exceeded ${metrics.maxLines}-line limit`;
    lines.push(`- Line count: ${metrics.lineCount} lines (non-blank, non-comment) [Limit: <= ${metrics.maxLines} lines — ${status}]`);
  } else if (metrics.exactLines !== null) {
    const status = metrics.lineCountPassed ? 'PASSED' : `FAILED: expected exactly ${metrics.exactLines} lines`;
    lines.push(`- Line count: ${metrics.lineCount} lines (non-blank, non-comment) [Exact: ${metrics.exactLines} lines — ${status}]`);
  } else {
    lines.push(`- Line count: ${metrics.lineCount} lines (non-blank, non-comment)`);
  }

  // Static checks only
  lines.push('- Static checks only:');
  if (metrics.syntax) {
    const synStatus = metrics.syntax.passed ? 'PASSED' : `FAILED (${metrics.syntax.error})`;
    lines.push(`  - Syntax check (${metrics.syntax.tool}): ${synStatus}`);
  }
  if (metrics.linter) {
    const lintStatus = metrics.linter.passed ? 'PASSED' : `FAILED (${metrics.linter.error || 'Issues found'})`;
    lines.push(`  - Linter (pyflakes & AST unused variables/parameters): ${lintStatus}`);
  }
  if (metrics.requiredLibraries && metrics.requiredLibraries.length > 0) {
    const missing = metrics.requiredLibraries.filter(lib => !metrics.imports.includes(lib));
    if (missing.length === 0) {
      lines.push(`  - Required libraries: ${metrics.requiredLibraries.join(', ')} [PASSED]`);
    } else {
      lines.push(`  - Required libraries: Missing ${missing.join(', ')} [FAILED]`);
    }
  }
  if (metrics.endpointModelValid === false) {
    lines.push(`  - Endpoint / model compatibility: FAILED (legacy /v1/completions used with chat model)`);
  }
  if (metrics.responseParsingValid === false) {
    lines.push(`  - Response payload parsing: FAILED (did not extract choices[0].message.content for chat completion)`);
  }
  if (metrics.hasPydanticMockCheck) {
    if (metrics.pydanticMockStatus === 'N/A (execution did not complete)') {
      lines.push(`  - Pydantic schema validation of LLM output (validated against mock): N/A (execution did not complete)`);
    } else if (metrics.pydanticMockStatus === 'PASSED') {
      lines.push(`  - Pydantic schema validation of LLM output (validated against mock): PASSED`);
    } else {
      lines.push(`  - Pydantic schema validation of LLM output (validated against mock): ${metrics.pydanticMockStatus || 'FAILED: LLM output not validated into Pydantic model'}`);
    }
  }

  // Execution check
  lines.push('- Execution check:');
  if (metrics.execution) {
    if (metrics.execution.executed) {
      if (metrics.execution.mode === 'mocked_network') {
        const status = metrics.execution.passed ? 'PASSED' : `FAILED (${metrics.execution.stderr || 'Runtime error'})`;
        lines.push(`  - Mocked-network run (local test harness with mock HTML & mock LLM responses): ${status}`);
        lines.push(`  - Live external endpoints: NOT INVOKED (static/mock verification only)`);
      } else {
        const exitStr = metrics.execution.exitCode === 0 ? 'exit 0' : `exit ${metrics.execution.exitCode}`;
        const status = metrics.execution.passed ? 'PASSED' : 'FAILED';
        lines.push(`  - Local scratch workspace run (${exitStr}): ${status}`);
      }
    } else {
      lines.push(`  - Local run: not executed (${metrics.execution.reason})`);
      lines.push(`  - Live external endpoints: NOT INVOKED (static/mock verification only)`);
    }
  }

  // Checks passed
  if (metrics.checksTotal > 0) {
    lines.push(`- Checks passed: ${metrics.checksPassed}/${metrics.checksTotal} (static & mock-run only; does not guarantee live 3rd-party API uptime)`);
  }

  return lines.join('\n');
}

module.exports = {
  parseConstraints,
  countCodeLines,
  extractImports,
  checkSyntax,
  checkLinter,
  checkExecution,
  verifyCode,
  generateVerificationBlock
};
