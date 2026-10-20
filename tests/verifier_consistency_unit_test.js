import dotenv from 'dotenv';
dotenv.config({ override: true });
import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const codeVerifier = require('../src/services/codeVerifier.js');

async function runVerifierConsistencyTests() {
  console.log('================================================================');
  console.log('TASK 1 — VERIFIER CONSISTENCY UNIT TESTS');
  console.log('================================================================\n');

  const prompt = "Write a 50-line Python script that scrapes a page, sends text to an LLM API and returns Pydantic-validated JSON";

  // ---------------------------------------------------------------------------
  // (i) Syntax Error Code -> Pydantic check must be N/A (execution did not complete)
  // ---------------------------------------------------------------------------
  console.log('[UNIT TEST (i)] Testing syntax error code...');
  const syntaxErrorCode = `
import os, requests, json, bs4 import BeautifulSoup # Syntax error line 2
from pydantic import BaseModel
class Data(BaseModel):
    val: str
`;
  const res1 = codeVerifier.verifyCode({ prompt, code: syntaxErrorCode, language: 'python' });
  const block1 = codeVerifier.generateVerificationBlock(res1.metrics);

  console.log('[UNIT TEST (i) Output Block]:\n' + block1 + '\n');
  assert.strictEqual(res1.metrics.syntax.passed, false, 'Syntax check must fail for invalid syntax');
  assert.strictEqual(res1.metrics.pydanticMockStatus, 'N/A (execution did not complete)', 'Pydantic mock status must be N/A when syntax check fails');
  assert(block1.includes('Pydantic schema validation of LLM output (validated against mock): N/A (execution did not complete)'),
    'Verification block must state N/A for Pydantic mock when syntax fails');
  assert(!block1.includes('Pydantic schema validation of LLM output (validated against mock): PASSED'),
    'Verification block must NEVER state PASSED when syntax check fails');
  assert.strictEqual(res1.metrics.requirementsCovered, 'N/A', 'Requirement coverage must be N/A when syntax fails');
  assert(block1.includes('- Requirements covered: N/A (execution did not complete)'), 'Verification block must report Requirements covered: N/A on syntax failure');
  assert(!block1.match(/- Requirements covered:\s*\d+\/\d+/), 'Verification block must NEVER show X/Y covered on broken code');
  console.log('✅ Unit Test (i) PASSED: Syntax error code reports N/A for Pydantic mock validation and requirement coverage.\n');

  // ---------------------------------------------------------------------------
  // (ii) Valid Code + Failed Mock Run -> Pydantic check must be N/A
  // ---------------------------------------------------------------------------
  console.log('[UNIT TEST (ii)] Testing valid code with failed mock run...');
  const failedMockRunCode = `
import os, requests, json
from bs4 import BeautifulSoup
from pydantic import BaseModel

class Data(BaseModel):
    val: str

def run():
    raise RuntimeError("Mock network simulation failed intentionally")

if __name__ == "__main__":
    run()
`;
  const res2 = codeVerifier.verifyCode({ prompt, code: failedMockRunCode, language: 'python' });
  const block2 = codeVerifier.generateVerificationBlock(res2.metrics);

  console.log('[UNIT TEST (ii) Output Block]:\n' + block2 + '\n');
  assert.strictEqual(res2.metrics.syntax.passed, true, 'Syntax check must pass for valid Python');
  assert.strictEqual(res2.metrics.execution.passed, false, 'Execution must fail due to runtime exception');
  assert.strictEqual(res2.metrics.pydanticMockStatus, 'N/A (execution did not complete)', 'Pydantic mock status must be N/A when execution fails');
  assert(block2.includes('Pydantic schema validation of LLM output (validated against mock): N/A (execution did not complete)'),
    'Verification block must state N/A for Pydantic mock when execution fails');
  assert(!block2.includes('Pydantic schema validation of LLM output (validated against mock): PASSED'),
    'Verification block must NEVER state PASSED when execution fails');
  assert.strictEqual(res2.metrics.requirementsCovered, 'N/A', 'Requirement coverage must be N/A when execution fails');
  assert(block2.includes('- Requirements covered: N/A (execution did not complete)'), 'Verification block must report Requirements covered: N/A on execution failure');
  assert(!block2.match(/- Requirements covered:\s*\d+\/\d+/), 'Verification block must NEVER show X/Y covered on broken code');
  console.log('✅ Unit Test (ii) PASSED: Valid code with failed mock run reports N/A for Pydantic mock validation and requirement coverage.\n');

  // ---------------------------------------------------------------------------
  // (iii) Valid Code + Passed Mock Run -> Pydantic check must be PASSED
  // ---------------------------------------------------------------------------
  console.log('[UNIT TEST (iii)] Testing valid code with passed mock run...');
  const passedMockRunCode = `
import os
import json
import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel
from typing import List

class Quote(BaseModel):
    text: str
    author: str
    tags: List[str]

class QuoteResponse(BaseModel):
    quotes: List[Quote]

def scrape(url: str) -> str:
    res = requests.get(url)
    soup = BeautifulSoup(res.text, "html.parser")
    data = []
    for q in soup.find_all("div", class_="quote"):
        data.append({
            "text": q.find("span", class_="text").text,
            "author": q.find("small", class_="author").text,
            "tags": [t.text for t in q.find_all("a", class_="tag")]
        })
    return json.dumps(data)

def analyze(data: str) -> QuoteResponse:
    key = os.getenv("OPENAI_API_KEY")
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": data}],
        "response_format": {"type": "json_object"}
    }
    resp = requests.post(url, headers=headers, json=payload)
    content = resp.json()['choices'][0]['message']['content']
    return QuoteResponse.model_validate_json(content)

if __name__ == "__main__":
    raw = scrape("https://quotes.toscrape.com")
    result = analyze(raw)
    print(f"Validated {len(result.quotes)} quotes")
`;
  const res3 = codeVerifier.verifyCode({ prompt, code: passedMockRunCode, language: 'python' });
  const block3 = codeVerifier.generateVerificationBlock(res3.metrics);

  console.log('[UNIT TEST (iii) Output Block]:\n' + block3 + '\n');
  assert.strictEqual(res3.metrics.syntax.passed, true, 'Syntax check must pass');
  assert.strictEqual(res3.metrics.execution.passed, true, 'Execution must pass');
  assert.strictEqual(res3.metrics.pydanticMockStatus, 'PASSED', 'Pydantic mock status must be PASSED');
  assert(block3.includes('Pydantic schema validation of LLM output (validated against mock): PASSED'),
    'Verification block must state PASSED for Pydantic mock when execution succeeds');
  assert.strictEqual(res3.metrics.requirementsCovered, 3, 'Requirement coverage must be 3 when all requirements are met');
  assert(block3.includes('- Requirements covered: 3/3'), 'Verification block must report Requirements covered: 3/3');
  assert.strictEqual(res3.metrics.checksPassed, res3.metrics.checksTotal, 'All executed checks must pass');
  console.log('✅ Unit Test (iii) PASSED: Valid code with passed mock run reports PASSED (validated against mock).\n');

  // ---------------------------------------------------------------------------
  // (iv) Unavailable Linter Runtime Check -> Linter: N/A (not installed)
  // ---------------------------------------------------------------------------
  console.log('[UNIT TEST (iv)] Testing unavailable linter runtime check...');
  const res4 = codeVerifier.verifyCode({
    prompt,
    code: passedMockRunCode,
    language: 'python',
    _linterCheck: () => ({
      passed: true,
      tool: 'pyflakes & AST linter',
      available: false,
      issues: [],
      error: null
    })
  });
  const block4 = codeVerifier.generateVerificationBlock(res4.metrics);

  console.log('[UNIT TEST (iv) Output Block]:\n' + block4 + '\n');
  assert.strictEqual(res4.metrics.linter.available, false, 'Linter metric must show available: false');
  assert(block4.includes('  - Linter: N/A (not installed)'),
    'Verification block must report "Linter: N/A (not installed)" when linter module is missing');
  assert(!block4.includes('pyflakes'),
    'Verification block must not output pyflakes when linter is unavailable');
  assert(!block4.includes('/opt/render') && !block4.includes('Traceback'),
    'Verification block must never print system paths or stack traces in replies');
  // Linter must be excluded from checksTotal count
  assert.strictEqual(res4.metrics.checksTotal, res3.metrics.checksTotal - 1,
    'Linter check must be excluded from checksTotal count when unavailable');
  assert.strictEqual(res4.metrics.checksPassed, res4.metrics.checksTotal,
    'Checks passed should match checksTotal without counting linter');
  assert.strictEqual(res4.passed, true,
    'verifyCode must pass when only linter is unavailable');
  console.log('✅ Unit Test (iv) PASSED: Unavailable linter reports "Linter: N/A (not installed)", excluded from checks count with zero leaked paths.\n');

  console.log('================================================================');
  console.log('🎉 ALL VERIFIER CONSISTENCY UNIT TESTS PASSED!');
  console.log('================================================================');
}

runVerifierConsistencyTests().catch(err => {
  console.error('❌ VERIFIER CONSISTENCY UNIT TESTS FAILED:', err);
  process.exit(1);
});
