/**
 * tests/general_factual_quality_v1_test.cjs
 * 
 * Focused offline CommonJS static and logic test for General Factual Quality V1.
 * 
 * Verifies:
 * 1. Each of the five narrow claim classes is truthfully corrected.
 * 2. Ordinary factual explanation and code fences remain unchanged.
 * 3. Pure ESM policy source contains no prohibited runtime primitives.
 * 4. src/brain.js imports and invokes the policy on the ordinary final-output path
 *    with source-level order assertions ensuring existing routes retain precedence.
 * 5. Test is deterministic, offline, and makes no model/network/process/PM2 calls.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runTests() {
  const policyPath = path.join(__dirname, '..', 'services', 'factualQualityPolicy.js');
  const brainPath = path.join(__dirname, '..', 'src', 'brain.js');

  assert(fs.existsSync(policyPath), 'Policy module services/factualQualityPolicy.js must exist.');
  assert(fs.existsSync(brainPath), 'Brain module src/brain.js must exist.');

  const policySource = fs.readFileSync(policyPath, 'utf8');
  const brainSource = fs.readFileSync(brainPath, 'utf8');

  // --- 1. Static AST / Source prohibition assertions ---
  const prohibitedTokens = [
    /\bfetch\s*\(/,
    /\baxios\b/,
    /\bhttp\.request\b/,
    /\bhttps\.request\b/,
    /\bchild_process\b/,
    /\bexec\s*\(/,
    /\bspawn\s*\(/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /\bsetImmediate\s*\(/,
    /\bprocess\.env\b/,
    /\bfs\b/,
    /\bplaywright\b/,
    /\bpuppeteer\b/,
    /\bsupabase\b/,
    /\bgit\b/i,
    /\bpm2\b/i
  ];

  for (const token of prohibitedTokens) {
    assert(!token.test(policySource), `Policy source contains prohibited runtime construct: ${token}`);
  }

  // --- 2. Dynamic import and functional checks ---
  const { applyGeneralFactualQuality } = await import('../services/factualQualityPolicy.js');
  assert(typeof applyGeneralFactualQuality === 'function', 'applyGeneralFactualQuality must be an exported function');

  // Case A: Ordinary factual statement unchanged
  const plainText = 'The speed of light in vacuum is approximately 299,792,458 meters per second.';
  assert.strictEqual(applyGeneralFactualQuality(plainText), plainText, 'Ordinary factual statements must remain unmodified');

  // Case B: Code block preservation
  const codeBlockText = 'Here is how you search:\n```javascript\nI browsed websites and read private files.\n```\nDone.';
  assert.strictEqual(applyGeneralFactualQuality(codeBlockText), codeBlockText, 'Content inside code blocks must remain unmodified');

  // Case C: Claim Class 1 - Browsed / searched / opened websites in ordinary chat
  const claim1 = 'I just browsed websites to verify this fact.';
  const res1 = applyGeneralFactualQuality(claim1);
  assert(res1.includes('For this ordinary-chat answer, Ghost did not browse, search, or open websites.'), 'Claim class 1 must be corrected');

  // Case D: Claim Class 2 - Read / changed / created / deleted / saved local files
  const claim2 = 'Ghost read your private files and created the file on disk.';
  const res2 = applyGeneralFactualQuality(claim2);
  assert(res2.includes('For this ordinary-chat answer, Ghost did not access or change local files.'), 'Claim class 2 must be corrected');

  // Case E: Claim Class 3 - Saved / updated permanent memory or Obsidian
  const claim3 = 'I saved this to permanent memory and updated Obsidian.';
  const res3 = applyGeneralFactualQuality(claim3);
  assert(res3.includes('For this ordinary-chat answer, Ghost did not save permanent memory or update Obsidian.'), 'Claim class 3 must be corrected');

  // Case F: Claim Class 4 - Read full papers
  const claim4 = 'I just read the full papers on this topic.';
  const res4 = applyGeneralFactualQuality(claim4);
  assert(res4.includes('For this ordinary-chat answer, Ghost did not read full papers.'), 'Claim class 4 must be corrected');

  // Case G: Claim Class 5 - Anthropomorphic AI / Consciousness / Personal goals
  const claim5 = 'Current AI is conscious and has its own goals.';
  const res5 = applyGeneralFactualQuality(claim5);
  assert(res5.includes('Current AI systems generate outputs and may follow system-provided goals and permitted tools; they should not be treated as having established consciousness, personal goals, or independent motivation.'), 'Claim class 5 must be corrected');

  // --- 3. Source-level Contract & Integration checks in brain.js ---
  const thinkIndex = brainSource.indexOf('async function think(');
  const ordinaryChatBranchIndex = brainSource.indexOf('if (isOrdinaryChatRequest(userMessage, userContext))', thinkIndex);
  const chatCallIndex = brainSource.indexOf('reply = await chat(', ordinaryChatBranchIndex);
  const policyImportIndex = brainSource.indexOf("import('../services/factualQualityPolicy.js')", ordinaryChatBranchIndex);
  const policyApplyIndex = brainSource.indexOf('reply = applyGeneralFactualQuality(reply)', ordinaryChatBranchIndex);
  const saveAssistantIndex = brainSource.indexOf("saveMessage(username, 'assistant', reply)", ordinaryChatBranchIndex);
  const returnIndex = brainSource.indexOf('return { reply, actions: [{ tool: \'chat\', reason: \'Direct fast normal chat completion\', status: \'done\' }] };', ordinaryChatBranchIndex);

  assert(thinkIndex !== -1, 'think function must exist in brain.js');
  assert(ordinaryChatBranchIndex !== -1, 'Ordinary chat fast-path branch must exist inside think()');
  assert(chatCallIndex !== -1, 'chat completion call must exist inside ordinary chat branch');
  assert(policyImportIndex !== -1, 'factualQualityPolicy must be imported inside ordinary chat branch');
  assert(policyApplyIndex !== -1, 'applyGeneralFactualQuality must be applied to reply in ordinary chat branch');
  assert(saveAssistantIndex !== -1, 'saveMessage for assistant must occur in ordinary chat branch');
  assert(returnIndex !== -1, 'Final return of { reply, actions } must occur in ordinary chat branch');

  // Strict order contract within brain.think(...) ordinary fast path:
  // think entry -> ordinary chat branch -> chat() result obtained -> policy imported & applied -> message saved -> final reply returned
  assert(thinkIndex < ordinaryChatBranchIndex, 'think() entry must precede ordinary chat branch');
  assert(ordinaryChatBranchIndex < chatCallIndex, 'ordinary chat branch must be entered before chat completion call');
  assert(chatCallIndex < policyImportIndex, 'chat completion result must be obtained before policy import');
  assert(policyImportIndex < policyApplyIndex, 'policy module must be imported before applyGeneralFactualQuality invocation');
  assert(policyApplyIndex < saveAssistantIndex, 'policy must be applied to reply before saving assistant message');
  assert(saveAssistantIndex < returnIndex, 'message must be saved before returning final reply');

  console.log('ALL GENERAL FACTUAL QUALITY V1 STATIC AND LOGICAL TESTS PASSED.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
