import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const brain = require('../src/brain.js');
const codeVerifier = require('../src/services/codeVerifier.js');
const { hasInternalLeak, sanitizeResponseText, sanitizeReasoningSteps } = require('../src/services/responseSanitizer.js');

async function runPhase8aTests() {
  console.log('================================================================');
  console.log('PHASE 8A — OUTPUT QUALITY + CODE VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1: 50-line Python scraper-to-JSON script
  // -------------------------------------------------------------------------
  console.log('[TEST 1] Testing 50-line Python scraper with Pydantic validation...');
  const prompt1 = "Write a 50-line Python script that scrapes a page, sends text to an LLM API and returns Pydantic-validated JSON";
  
  // Verify routing detection
  assert.strictEqual(brain.isCodeGenerationRequest(prompt1), true, 'Prompt 1 must be detected as code generation request');

  const res1 = await brain.think(prompt1, { safeUser: 'admin', isAdmin: true });
  assert(res1 && res1.reply, 'Test 1 must return a reply');
  assert.strictEqual(res1.isCodeAnswer, true, 'Test 1 must be processed via codeAnswer path');
  assert(res1.actions && res1.actions.some(a => a.tool === 'code_verifier'), 'Test 1 actions must indicate code_verifier');

  // Extract code block
  const codeMatch1 = res1.reply.match(/```(?:python)?\s*\n([\s\S]*?)```/i);
  assert(codeMatch1, 'Test 1 reply must contain a fenced Python code block');
  const code1 = codeMatch1[1].trim();

  // Measure non-blank, non-comment line count
  const lineCount1 = codeVerifier.countCodeLines(code1, 'python');
  console.log(`[TEST 1 Measurement] Non-blank, non-comment line count: ${lineCount1} (Limit: <= 50)`);
  assert(lineCount1 <= 50, `Line count (${lineCount1}) must be <= 50 lines`);

  // Programmatic py_compile syntax check
  const syntax1 = codeVerifier.checkSyntax(code1, 'python');
  console.log(`[TEST 1 Syntax Check] ${syntax1.tool} passed: ${syntax1.passed}`);
  assert.strictEqual(syntax1.passed, true, `py_compile must pass on generated code: ${syntax1.error || ''}`);

  // Verification block presence, static-only disclaimer, pyflakes, mocked execution, and no leak check
  assert(res1.reply.includes('### Verification'), 'Test 1 reply must end with a ### Verification block');
  assert(res1.reply.includes(`Line count: ${lineCount1} lines`), 'Verification block must report exact measured line count');
  assert(res1.reply.includes('Static checks only:'), 'Verification block must explicitly state "Static checks only"');
  assert(res1.reply.includes('pyflakes'), 'Verification block must verify pyflakes');
  assert(res1.reply.includes('Pydantic schema validation of LLM output (validated against mock): PASSED'), 'Verification block must report Pydantic schema validation validated against mock');
  assert(res1.reply.includes('Mocked-network run'), 'Verification block must report mocked-network run');
  assert(res1.reply.includes('Live external endpoints: NOT INVOKED'), 'Verification block must confirm live endpoints were not invoked');
  assert.strictEqual(hasInternalLeak(res1.reply), false, 'Test 1 reply must contain no internal status/route leaks');

  console.log('\n--- FULL RAW REPLY TEXT FROM TEST 1 ---');
  console.log(res1.reply);
  console.log('--- END RAW REPLY TEXT FROM TEST 1 ---\n');
  console.log('✅ TEST 1 PASSED: Line count <= 50, py_compile PASSED, Verification block present, zero leaks.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Deliberately impossible constraint (10-line complex script)
  // -------------------------------------------------------------------------
  console.log('[TEST 2] Testing deliberately impossible constraint (10-line script)...');
  const prompt2 = "Write a 10-line Python script that scrapes a website, runs a full web server, trains a machine learning model, sends text to an LLM API and returns Pydantic-validated JSON";
  
  assert.strictEqual(brain.isCodeGenerationRequest(prompt2), true, 'Prompt 2 must be detected as code generation request');
  const res2 = await brain.think(prompt2, { safeUser: 'admin', isAdmin: true });

  assert(res2 && res2.reply, 'Test 2 must return a reply');
  assert.strictEqual(res2.isCodeAnswer, true, 'Test 2 must be processed via codeAnswer path');
  assert(res2.reply.includes('### Verification'), 'Test 2 reply must end with a ### Verification block');

  console.log('\n--- FULL RAW REPLY TEXT FROM TEST 2 ---');
  console.log(res2.reply);
  console.log('--- END RAW REPLY TEXT FROM TEST 2 ---\n');

  // Check that it honestly reports that it could not meet the 10-line constraint
  const codeMatch2 = res2.reply.match(/```(?:python)?\s*\n([\s\S]*?)```/i);
  assert(codeMatch2, 'Test 2 reply must contain a code block');
  const lineCount2 = codeVerifier.countCodeLines(codeMatch2[1], 'python');
  console.log(`[TEST 2 Measurement] Line count: ${lineCount2} (Constraint was: 10 lines)`);
  assert(lineCount2 > 10, 'Test 2 script should exceed impossible 10-line constraint');
  assert(res2.reply.includes('FAILED: exceeded 10-line limit'), 'Test 2 Verification block must report FAILED for 10-line limit');
  assert.strictEqual(hasInternalLeak(res2.reply), false, 'Test 2 reply must contain no internal status/route leaks');
  console.log('✅ TEST 2 PASSED: Honestly reports failure to meet impossible 10-line limit.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Ordinary chat message ("hi")
  // -------------------------------------------------------------------------
  console.log('[TEST 3] Testing ordinary chat message ("hi")...');
  const prompt3 = "hi";
  assert.strictEqual(brain.isCodeGenerationRequest(prompt3), false, '"hi" must NOT be detected as code generation request');

  const res3 = await brain.think(prompt3, { safeUser: 'admin', isAdmin: true });
  assert(res3 && res3.reply, 'Test 3 must return a reply');
  assert.strictEqual(Boolean(res3.isCodeAnswer), false, '"hi" must NOT go through codeAnswer path');

  // Check actions and reply for internal status/route labels
  assert.strictEqual(hasInternalLeak(res3.reply), false, 'Test 3 reply text must contain no internal labels');
  const sanitizedReply3 = sanitizeResponseText(res3.reply);
  assert.strictEqual(sanitizedReply3.includes('Direct fast'), false, 'Reply must not contain "Direct fast"');
  assert.strictEqual(sanitizedReply3.includes('[Brain Route]'), false, 'Reply must not contain "[Brain Route]"');
  assert.strictEqual(sanitizedReply3.includes('completion...'), false, 'Reply must not contain "completion..."');

  const sanitizedActions3 = sanitizeReasoningSteps(res3.actions || []);
  assert(sanitizedActions3.every(a => !hasInternalLeak(a.reason) && !hasInternalLeak(a.tool)), 'Sanitized actions must not contain internal route labels');

  console.log('[TEST 3 Output Sample]:', sanitizedReply3.slice(0, 100));
  console.log('✅ TEST 3 PASSED: Ordinary chat did NOT go through codeAnswer and contains zero internal labels.\n');

  console.log('================================================================');
  console.log('🎉 ALL PHASE 8A CODE VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runPhase8aTests().catch(err => {
  console.error('❌ PHASE 8A TEST SUITE FAILED:', err);
  process.exit(1);
});
