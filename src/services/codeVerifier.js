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
    const stderr = err.stderr ? err.stderr.toString().trim() : (err.message || 'Syntax error');
    return {
      passed: false,
      tool: language === 'python' ? 'py_compile' : 'node --check',
      error: stderr.split('\n').pop() || stderr
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
  }
}

/**
 * Checks whether the code requires network, keys, or interactive input.
 * If not, executes the code in local scratch workspace with a 10s timeout.
 */
function checkExecution(code, language = 'python', scratchDir = null) {
  if (!code || typeof code !== 'string') {
    return { executed: false, reason: 'Empty code' };
  }

  const needsNetwork = /\b(urllib\.request|requests\.|httpx\.|aiohttp\.|fetch\(|https?:\/\/|http\.client|socket\b)/i.test(code);
  const needsKeys = /\b(os\.environ|os\.getenv|process\.env|api[_-]?key|secret|auth_token)\b/i.test(code);
  const needsInput = /\b(input\(|stdin\.read|readline\()/i.test(code);

  if (needsNetwork || needsKeys || needsInput) {
    const reasons = [];
    if (needsNetwork && needsKeys) {
      reasons.push('requires external network access for scraping and live API key credentials');
    } else if (needsNetwork) {
      reasons.push('requires live external network access');
    } else if (needsKeys) {
      reasons.push('requires external API key credentials not present in local execution environment');
    }
    if (needsInput) {
      reasons.push('requires interactive stdin user input');
    }
    return {
      executed: false,
      reason: reasons.join('; ')
    };
  }

  // Safe to execute in local scratch workspace
  const dir = scratchDir || path.resolve(process.cwd(), 'scratch');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ext = language === 'python' ? '.py' : '.js';
  const tempFile = path.join(dir, `_exec_run_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  try {
    fs.writeFileSync(tempFile, code, 'utf-8');
    const cmd = language === 'python' ? `python3 "${tempFile}"` : `node "${tempFile}"`;
    const stdout = execSync(cmd, {
      cwd: dir,
      timeout: 10000,
      env: { ...process.env, PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();

    return {
      executed: true,
      exitCode: 0,
      stdout: stdout.trim().slice(0, 300),
      passed: true
    };
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString().trim().slice(0, 300) : '';
    const stderr = err.stderr ? err.stderr.toString().trim().slice(0, 300) : err.message;
    return {
      executed: true,
      exitCode: typeof err.status === 'number' ? err.status : 1,
      stdout,
      stderr: stderr.split('\n').pop() || stderr,
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

  // 4. Syntax check
  checksTotal++;
  const syntax = checkSyntax(code, lang, scratchDir);
  if (syntax.passed) {
    checksPassed++;
  } else {
    failures.push(`Syntax check failed (${syntax.tool}): ${syntax.error}`);
  }

  // 5. Execution check
  const execution = checkExecution(code, lang, scratchDir);
  if (execution.executed) {
    checksTotal++;
    if (execution.passed) {
      checksPassed++;
    } else {
      failures.push(`Execution failed: ${execution.stderr || 'Non-zero exit'}`);
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
      syntax,
      execution,
      checksPassed,
      checksTotal
    }
  };
}

/**
 * Builds the final "Verification" markdown block containing strictly measured facts.
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

  // Syntax check
  if (metrics.syntax) {
    const synStatus = metrics.syntax.passed ? 'PASSED' : `FAILED (${metrics.syntax.error})`;
    lines.push(`- Syntax check: ${metrics.syntax.tool} ${synStatus}`);
  }

  // Required libraries
  if (metrics.requiredLibraries && metrics.requiredLibraries.length > 0) {
    const missing = metrics.requiredLibraries.filter(lib => !metrics.imports.includes(lib));
    if (missing.length === 0) {
      lines.push(`- Required libraries: ${metrics.requiredLibraries.join(', ')} [PASSED]`);
    } else {
      lines.push(`- Required libraries: Missing ${missing.join(', ')} [FAILED]`);
    }
  }

  // Execution
  if (metrics.execution) {
    if (metrics.execution.executed) {
      const exitStr = metrics.execution.exitCode === 0 ? 'exit 0' : `exit ${metrics.execution.exitCode}`;
      const outSnippet = metrics.execution.stdout ? ` Output: ${metrics.execution.stdout.replace(/\n/g, ' ')}` : '';
      lines.push(`- Execution: executed in local scratch workspace (${exitStr}).${outSnippet}`);
    } else {
      lines.push(`- Execution: syntax-checked, not executed (${metrics.execution.reason})`);
    }
  }

  // Checks passed
  if (metrics.checksTotal > 0) {
    lines.push(`- Checks passed: ${metrics.checksPassed}/${metrics.checksTotal}`);
  }

  return lines.join('\n');
}

module.exports = {
  parseConstraints,
  countCodeLines,
  extractImports,
  checkSyntax,
  checkExecution,
  verifyCode,
  generateVerificationBlock
};
