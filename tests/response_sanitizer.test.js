import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  hasInternalLeak,
  sanitizeResponseText,
  sanitizeReasoningSteps,
  INTERNAL_LEAK_PATTERNS
} = require('../src/services/responseSanitizer.js');

function runTests() {
  console.log('Running Response Sanitizer Tests...');

  // Test 1: Direct fast normal chat completion leak
  const leaked1 = '*Direct fast normal chat completion...* Here is your requested answer.';
  assert.strictEqual(hasInternalLeak(leaked1), true, 'Should detect Direct fast normal chat completion leak');
  const clean1 = sanitizeResponseText(leaked1);
  assert.strictEqual(hasInternalLeak(clean1), false, 'Sanitized text should have no leaks');
  assert.strictEqual(clean1.includes('Direct fast'), false, 'Clean text must not contain Direct fast');
  assert.strictEqual(clean1.includes('completion...'), false, 'Clean text must not contain completion...');
  assert.strictEqual(clean1, 'Here is your requested answer.');

  // Test 2: [Brain Route] label leak
  const leaked2 = '[Brain Route] Routing deep research query.\nHere is the report.';
  assert.strictEqual(hasInternalLeak(leaked2), true, 'Should detect [Brain Route] leak');
  const clean2 = sanitizeResponseText(leaked2);
  assert.strictEqual(hasInternalLeak(clean2), false, 'Sanitized text should have no [Brain Route]');
  assert.strictEqual(clean2.includes('[Brain Route]'), false, 'Clean text must not contain [Brain Route]');

  // Test 3: [Brain Fast Path] label leak
  const leaked3 = '[Brain Fast Path] Routing ordinary chat request directly';
  assert.strictEqual(hasInternalLeak(leaked3), true, 'Should detect [Brain Fast Path] leak');
  const clean3 = sanitizeResponseText(leaked3);
  assert.strictEqual(hasInternalLeak(clean3), false, 'Sanitized text should have no [Brain Fast Path]');

  // Test 4: completion... leak
  const leaked4 = 'Processing fast completion... done.';
  assert.strictEqual(hasInternalLeak(leaked4), true, 'Should detect completion... leak');
  const clean4 = sanitizeResponseText(leaked4);
  assert.strictEqual(hasInternalLeak(clean4), false, 'Sanitized text should have no completion...');

  // Test 5: Reasoning actions array filtering
  const actions = [
    { tool: 'chat', reason: 'Direct fast normal chat completion', status: 'done' },
    { tool: 'code_verifier', reason: 'Verified code generation', status: 'done' },
    { tool: 'orchestrator_run', reason: '[Brain Route] Subtask execution', status: 'done' }
  ];
  const safeActions = sanitizeReasoningSteps(actions);
  assert.strictEqual(safeActions.length, 1, 'Should filter out internal route labels, keeping only valid step');
  assert.strictEqual(safeActions[0].tool, 'code_verifier');
  assert.strictEqual(safeActions[0].reason, 'Verified code generation');

  // Test 6: Clean ordinary message should remain untouched
  const cleanMsg = 'Hello! How can I assist you with your project today?';
  assert.strictEqual(hasInternalLeak(cleanMsg), false, 'Clean message should not trigger leak detector');
  assert.strictEqual(sanitizeResponseText(cleanMsg), cleanMsg, 'Clean message should not be altered');

  console.log('✅ ALL RESPONSE SANITIZER TESTS PASSED.');
}

runTests();
