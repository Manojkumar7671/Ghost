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

  // Test 7: Internal capability names leak (scholarly-dossier)
  const leaked7 = 'If verified academic citations are required, please use the scholarly-dossier capability for sources.';
  assert.strictEqual(hasInternalLeak(leaked7), true, 'Should detect scholarly-dossier capability leak');
  const clean7 = sanitizeResponseText(leaked7);
  assert.strictEqual(hasInternalLeak(clean7), false, 'Sanitized text should have no scholarly-dossier leak');
  assert.strictEqual(clean7.includes('scholarly-dossier'), false, 'Clean text must not contain scholarly-dossier');

  // Test 8: Internal tool names leak (workspace_run_command, orchestrator_run, stock_quote)
  const leaked8 = 'I will execute workspace_run_command to check the repository, and orchestrator_run for subtasks.';
  assert.strictEqual(hasInternalLeak(leaked8), true, 'Should detect internal tool names leak');
  const clean8 = sanitizeResponseText(leaked8);
  assert.strictEqual(hasInternalLeak(clean8), false, 'Sanitized text should have no tool name leaks');
  assert.strictEqual(clean8.includes('workspace_run_command'), false, 'Clean text must not contain workspace_run_command');
  assert.strictEqual(clean8.includes('orchestrator_run'), false, 'Clean text must not contain orchestrator_run');

  // Test 9: Route labels and internal status markers ([Server Log], [Startup Warning], [Code Routing])
  const leaked9 = '[Server Log] Reply served | Provider: Groq\n[Startup Warning] Key invalid\n[Code Routing] Routed code';
  assert.strictEqual(hasInternalLeak(leaked9), true, 'Should detect route labels leak');
  const clean9 = sanitizeResponseText(leaked9);
  assert.strictEqual(hasInternalLeak(clean9), false, 'Sanitized text should have no route labels leak');
  assert.strictEqual(clean9.includes('[Server Log]'), false, 'Clean text must not contain [Server Log]');
  assert.strictEqual(clean9.includes('[Startup Warning]'), false, 'Clean text must not contain [Startup Warning]');
  assert.strictEqual(clean9.includes('[Code Routing]'), false, 'Clean text must not contain [Code Routing]');

  // Test 10: False-positive tests for normal answers using "orchestrator", "dossier", "workspace"
  const fpMsg1 = 'The orchestrator pattern coordinates multiple worker agents in a distributed architecture.';
  assert.strictEqual(hasInternalLeak(fpMsg1), false, 'Normal answer with "orchestrator" must not trigger leak detector');
  assert.strictEqual(sanitizeResponseText(fpMsg1), fpMsg1, 'Normal answer with "orchestrator" must pass unchanged');

  const fpMsg2 = 'Please make sure your workspace directory is clean before building the project.';
  assert.strictEqual(hasInternalLeak(fpMsg2), false, 'Normal answer with "workspace" must not trigger leak detector');
  assert.strictEqual(sanitizeResponseText(fpMsg2), fpMsg2, 'Normal answer with "workspace" must pass unchanged');

  const fpMsg3 = 'The investigative dossier contains comprehensive background research for the analysis.';
  assert.strictEqual(hasInternalLeak(fpMsg3), false, 'Normal answer with "dossier" must not trigger leak detector');
  assert.strictEqual(sanitizeResponseText(fpMsg3), fpMsg3, 'Normal answer with "dossier" must pass unchanged');

  const fpMsg4 = 'The workflow orchestrator organizes files in your workspace and prepares a detailed research dossier.';
  assert.strictEqual(hasInternalLeak(fpMsg4), false, 'Combined sentence with orchestrator, workspace, dossier must not trigger leak detector');
  assert.strictEqual(sanitizeResponseText(fpMsg4), fpMsg4, 'Combined sentence must pass unchanged');

  console.log('✅ ALL RESPONSE SANITIZER TESTS PASSED.');
}

runTests();
