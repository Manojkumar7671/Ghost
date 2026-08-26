/**
 * tests/skills_v0_test.cjs
 *
 * Focused offline CommonJS static and logic test for Ghost Skills V0.
 *
 * Verifies:
 * 1. Exact public catalog exports (`getCapabilitiesHelp`, `isCapabilityQuery`), with no default export.
 * 2. All allowed direct help prompts match, including safe casing/whitespace/question-mark variation.
 * 3. All rejected broad requests and route commands do not match.
 * 4. The static reply contains all four capability headings, three example syntaxes, `PLAN ONLY — NO LOCAL WRITES`, and each hard boundary.
 * 5. The catalog source is pure (structural prohibited-runtime scanner; no bare words).
 * 6. The static source proves `server.js` imports both catalog exports and dispatches the match branch immediately before ordinary `brain.think()` fallback.
 * 7. The static source proves the branch uses `createRouteReceipt('ordinary_no_action_evidence')`, `applyEvidenceWrapper(capabilityReply, receipt)`, `wrappedCapabilityText.trim()`, and all four JSON fields: `success`, `text`, `runId`, `execution`.
 * 8. The static source proves receipt/internal receipt fields are not added to that JSON response.
 * 9. Existing route markers for cited news, dossier, technical planning, and ordinary fallback remain present, so no special route was removed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runTests() {
  const catalogPath = path.join(__dirname, '..', 'services', 'capabilityCatalog.js');
  const serverPath = path.join(__dirname, '..', 'server.js');
  const wrapperPath = path.join(__dirname, '..', 'services', 'evidenceWrapper.js');

  assert(fs.existsSync(catalogPath), 'services/capabilityCatalog.js must exist');
  assert(fs.existsSync(serverPath), 'server.js must exist');
  assert(fs.existsSync(wrapperPath), 'services/evidenceWrapper.js must exist');

  const catalogSource = fs.readFileSync(catalogPath, 'utf8');
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  // --- Category 1: Exact Public Catalog ESM Exports ---
  const catalogModule = await import('../services/capabilityCatalog.js');
  const exportedKeys = Object.keys(catalogModule).sort();
  assert.deepStrictEqual(exportedKeys, ['getCapabilitiesHelp', 'isCapabilityQuery'], 'Module must export exactly two named functions');
  assert.strictEqual(catalogModule.default, undefined, 'Module must have zero default export');

  const { isCapabilityQuery, getCapabilitiesHelp } = catalogModule;
  assert(typeof isCapabilityQuery === 'function', 'isCapabilityQuery must be a function');
  assert(typeof getCapabilitiesHelp === 'function', 'getCapabilitiesHelp must be a function');

  // --- Category 2: Allowed Direct Help Prompts Match ---
  const allowedPrompts = [
    'what can you do',
    'what can you do?',
    'WHAT CAN YOU DO?',
    '  what can you do?  ',
    'what are your skills',
    'what are your skills?',
    'what skills do you have',
    'what skills do you have?',
    'show your capabilities',
    'show your capabilities?',
    'list your skills',
    'list your skills?',
    'capabilities',
    'capabilities?',
    'help me choose what you can do',
    'help me choose what you can do?'
  ];

  for (const prompt of allowedPrompts) {
    assert.strictEqual(isCapabilityQuery(prompt), true, `Allowed prompt should match: "${prompt}"`);
  }

  // --- Category 3: Rejected Broad Requests and Route Commands Do Not Match ---
  const rejectedPrompts = [
    'can you help me plan an app?',
    'can you explain quantum physics?',
    'what can you do for my project?',
    'research current space news',
    'dossier quantum physics',
    'mission design an API',
    'what can you do about the weather today?',
    'show me your capabilities in detail and write code',
    'list your skills for Python',
    'capabilities of quantum computing',
    '',
    '   ',
    null,
    undefined,
    123,
    {},
    []
  ];

  for (const prompt of rejectedPrompts) {
    assert.strictEqual(isCapabilityQuery(prompt), false, `Rejected prompt should not match: ${JSON.stringify(prompt)}`);
  }

  // --- Category 4: Static Reply Headings, Syntaxes, Banners, and Limits ---
  const helpText = getCapabilitiesHelp();
  assert(typeof helpText === 'string', 'getCapabilitiesHelp() must return a string');
  assert(helpText.includes('### 1. General Chat & Reasoning'), 'Must contain General Chat heading');
  assert(helpText.includes('### 2. Cited News Research'), 'Must contain Cited News heading');
  assert(helpText.includes('### 3. Academic Research Dossier'), 'Must contain Academic Dossier heading');
  assert(helpText.includes('### 4. Technical Copilot Planning'), 'Must contain Technical Planning heading');
  assert(helpText.includes('`research <topic>`'), 'Must contain research syntax');
  assert(helpText.includes('`dossier <topic>`'), 'Must contain dossier syntax');
  assert(helpText.includes('`mission <objective>`'), 'Must contain mission syntax');
  assert(helpText.includes('PLAN ONLY — NO LOCAL WRITES'), 'Must contain PLAN ONLY — NO LOCAL WRITES banner');
  assert(helpText.includes('Ghost did not browse websites, open linked pages, read full papers, access or modify local files, execute commands, or save permanent memory.'), 'Must contain universal boundary statement');

  // Verify Evidence Wrapper V0 compatibility
  const wrapperModule = await import('../services/evidenceWrapper.js');
  const { createRouteReceipt, applyEvidenceWrapper } = wrapperModule;
  const receipt = createRouteReceipt('ordinary_no_action_evidence');
  const wrappedText = applyEvidenceWrapper(helpText, receipt);
  assert(typeof wrappedText === 'string' && wrappedText.length > 0, 'Wrapped text must be valid non-empty string');
  assert(wrappedText.includes('PLAN ONLY — NO LOCAL WRITES'), 'Wrapped text must preserve technical planning banner');

  // --- Category 5: Structural Prohibited Runtime Scanner (No Bare Words) ---
  const prohibitedRuntimePatterns = [
    /\bimport\s+.*?\bfrom\s+['"][^'"]*['"]/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /\bfetch\s*\(/,
    /\baxios(?:\s*\(|\s*\.[a-zA-Z_$])/,
    /\bhttp\s*\.\s*(?:request|get)\b/,
    /\bhttps\s*\.\s*(?:request|get)\b/,
    /\bchild_process(?:\s*\.[a-zA-Z_$]|\s*\[)/,
    /\bexec\s*\(/,
    /\bexecSync\s*\(/,
    /\bspawn\s*\(/,
    /\bspawnSync\s*\(/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /\bsetImmediate\s*\(/,
    /\bprocess\s*\.\s*(?:env|exit|kill)\b/,
    /\bfs\s*\.\s*[a-zA-Z_$]/,
    /\bplaywright(?:\s*\.[a-zA-Z_$]|\s*\(|\s*\[)/,
    /\bpuppeteer(?:\s*\.[a-zA-Z_$]|\s*\(|\s*\[)/,
    /\bsupabase(?:\s*\.[a-zA-Z_$]|\s*\(|\s*\[)/,
    /\bgit\s*\.\s*[a-zA-Z_$]/,
    /\bpm2\s*\.\s*[a-zA-Z_$]/
  ];

  for (const pattern of prohibitedRuntimePatterns) {
    assert(!pattern.test(catalogSource), `Catalog source contains prohibited runtime construct: ${pattern}`);
  }

  // --- Scanner Regressions: Benign Inert Text vs. Genuine Forbidden Constructs ---
  const benignExplanatoryTexts = [
    "This catalog discusses axios, child_process, playwright, puppeteer, and supabase without invoking them.",
    "Ghost does not use fetch, fs, or process in this module.",
    "Ghost did not browse websites, open pages, access local files, execute commands, or save permanent memory."
  ];

  for (const text of benignExplanatoryTexts) {
    for (const pattern of prohibitedRuntimePatterns) {
      assert(!pattern.test(text), `Benign text should not trigger scanner: ${pattern} on "${text}"`);
    }
  }

  const syntheticDangerousCases = [
    { name: 'static import', code: "import axios from 'axios';" },
    { name: 'dynamic import', code: "const m = import('axios');" },
    { name: 'commonjs require', code: "const cp = require('child_process');" },
    { name: 'fetch call', code: "fetch('https://example.test');" },
    { name: 'axios member call', code: "axios.get('/x');" },
    { name: 'http get call', code: "http.get('/x');" },
    { name: 'https request call', code: "https.request({});" },
    { name: 'child_process member call', code: "child_process.exec('x');" },
    { name: 'exec call', code: "exec('x');" },
    { name: 'execSync call', code: "execSync('x');" },
    { name: 'spawn call', code: "spawn('x');" },
    { name: 'spawnSync call', code: "spawnSync('x');" },
    { name: 'setTimeout call', code: "setTimeout(() => {}, 1);" },
    { name: 'setInterval call', code: "setInterval(() => {}, 1);" },
    { name: 'setImmediate call', code: "setImmediate(() => {});" },
    { name: 'process.env access', code: "const key = process.env.SECRET;" },
    { name: 'fs member call', code: "fs.readFileSync('x');" },
    { name: 'playwright call', code: "playwright.chromium.launch();" },
    { name: 'puppeteer call', code: "puppeteer.launch();" },
    { name: 'supabase call', code: "supabase.from('items');" },
    { name: 'git member call', code: "git.commit('x');" },
    { name: 'pm2 member call', code: "pm2.reload('ghost-ai');" }
  ];

  for (const testCase of syntheticDangerousCases) {
    const matched = prohibitedRuntimePatterns.some(p => p.test(testCase.code));
    assert.strictEqual(matched, true, `Dangerous construct "${testCase.name}" (${testCase.code}) must trigger at least one scanner pattern`);
  }

  // --- Category 6: Server.js Import & Dispatch Location ---
  assert(
    serverSource.includes("import {\n    isCapabilityQuery,\n    getCapabilitiesHelp\n} from './services/capabilityCatalog.js';"),
    'server.js must import isCapabilityQuery and getCapabilitiesHelp from capabilityCatalog.js'
  );

  const capabilityBranchMarker = "if (isCapabilityQuery(finalMessage)) {";
  const brainThinkLogMarker = "console.log('[Server] Routing plain-text request to brain.think()...');";
  assert(serverSource.includes(capabilityBranchMarker), 'server.js must contain isCapabilityQuery(finalMessage) branch');
  assert(serverSource.includes(brainThinkLogMarker), 'server.js must contain brain.think log marker');

  const branchIndex = serverSource.indexOf(capabilityBranchMarker);
  const logIndex = serverSource.indexOf(brainThinkLogMarker);
  assert(branchIndex !== -1 && logIndex !== -1 && branchIndex < logIndex, 'Capability branch must appear immediately before brain.think() fallback');

  // --- Category 7: Flow, Lexical Scopes & 4-Field Response Evidence in Server.js ---
  const capabilityBranchBlock = serverSource.slice(branchIndex, logIndex);

  // Assertion A: Hoisted currentRun scope before outer try in active chat handler
  const outerTraceRunMarker = "await traceLocalStorage.run(requestContext, async () => {";
  const outerTryMarker = "try {\n            const { user, image, fileContent, fileBase64, fileName } = req.body;";
  const outerTraceRunIndex = serverSource.indexOf(outerTraceRunMarker);
  const outerTryIndex = serverSource.indexOf(outerTryMarker);
  assert(outerTraceRunIndex !== -1 && outerTryIndex !== -1 && outerTraceRunIndex < outerTryIndex, 'server.js active chat route must open traceLocalStorage.run and outer try');
  
  const outerHandlerPrefix = serverSource.slice(outerTraceRunIndex, outerTryIndex);
  assert(outerHandlerPrefix.includes("let currentRun;"), 'server.js must declare let currentRun before the outer try block');

  const runCreationArea = serverSource.slice(outerTryIndex, branchIndex);
  assert(runCreationArea.includes("currentRun = runController.createRun(safeUser || 'anonymous');"), 'server.js must retain currentRun assignment in run creation area');
  assert(!runCreationArea.includes("let currentRun;"), 'server.js run creation area must not redeclare let currentRun inside try block');

  // Assertion B: Capability branch execution initialization before response
  const execInitMarker = "const capabilityExecution = await getLatestExecutionStatus(req);";
  const resJsonMarker = "return res.json({";
  assert(capabilityBranchBlock.includes(execInitMarker), 'Capability branch must initialize execution via getLatestExecutionStatus(req)');
  assert(capabilityBranchBlock.includes(resJsonMarker), 'Capability branch must contain return res.json');
  assert(
    capabilityBranchBlock.indexOf(execInitMarker) < capabilityBranchBlock.indexOf(resJsonMarker),
    'Capability branch must resolve execution before sending res.json'
  );

  assert(capabilityBranchBlock.includes("const capabilityReply = getCapabilitiesHelp();"), 'Capability branch must call getCapabilitiesHelp()');
  assert(capabilityBranchBlock.includes("const receipt = createRouteReceipt('ordinary_no_action_evidence');"), 'Capability branch must construct ordinary_no_action_evidence receipt');
  assert(capabilityBranchBlock.includes("const wrappedCapabilityText = applyEvidenceWrapper(capabilityReply, receipt);"), 'Capability branch must apply evidence wrapper to capability reply');
  assert(capabilityBranchBlock.includes("text: wrappedCapabilityText.trim()"), 'Capability branch must assign wrappedCapabilityText.trim() to text field');
  assert(capabilityBranchBlock.includes("runId: typeof currentRun !== 'undefined' && currentRun ? currentRun.runId : undefined"), 'Capability branch must safely check currentRun runId');
  assert(capabilityBranchBlock.includes("execution: capabilityExecution\n                });"), 'Capability branch must include execution in res.json');

  // Ordinary path execution initialization remains present later
  const laterOrdinaryPath = serverSource.slice(logIndex);
  assert(laterOrdinaryPath.includes("const finalRouteExecution = await getLatestExecutionStatus(req);"), 'Ordinary path must retain its execution initialization');

  // --- Category 8: Zero Receipt Wire Leakage ---
  assert(!capabilityBranchBlock.includes("receipt:"), 'Capability branch must not serialize receipt in response');
  assert(!capabilityBranchBlock.includes("routeType:"), 'Capability branch must not serialize routeType in response');
  assert(!capabilityBranchBlock.includes("issuedByFactory"), 'Capability branch must not expose issuedByFactory in response');

  // --- Category 9: Preservation of Existing Special Routes ---
  assert(serverSource.includes("createRouteReceipt('cited_research'"), 'Cited research route must be preserved');
  assert(serverSource.includes("createRouteReceipt('research_dossier'"), 'Research dossier route must be preserved');
  assert(serverSource.includes("createRouteReceipt('technical_plan'"), 'Technical plan route must be preserved');
  assert(serverSource.includes("const ordinaryReceipt = createRouteReceipt('ordinary_no_action_evidence');"), 'Ordinary chat fallback receipt must be preserved');

  // --- Category 10: Bounded Ordinary-Fallback Authority Containment ---
  const fallbackStartMarker = "fullResponse = brainResult.reply;";
  const fallbackEndMarker = "res.json({ success: true, text: replyText.trim(), runId: typeof currentRun !== 'undefined' && currentRun ? currentRun.runId : undefined, execution: finalRouteExecution });";

  const fallbackStartIndex = serverSource.indexOf(fallbackStartMarker);
  const fallbackEndIndex = serverSource.indexOf(fallbackEndMarker, fallbackStartIndex);

  assert(fallbackStartIndex !== -1, "server.js must contain ordinary fallback start marker: fullResponse = brainResult.reply;");
  assert(fallbackEndIndex !== -1, "server.js must contain ordinary fallback end marker: res.json({ success: true, text: replyText.trim(), runId: typeof currentRun !== 'undefined' && currentRun ? currentRun.runId : undefined, execution: finalRouteExecution });");
  assert(fallbackStartIndex < fallbackEndIndex, 'Ordinary fallback start marker must precede end marker');

  const boundedFallbackSegment = serverSource.slice(fallbackStartIndex, fallbackEndIndex + fallbackEndMarker.length);

  // Assertion Group 10A: Six Banned Ordinary Side-Path Categories Absent in Bounded Segment
  assert(!boundedFallbackSegment.includes("extractToolCommand"), 'Bounded ordinary fallback must not invoke extractToolCommand');
  assert(!boundedFallbackSegment.includes("pendingActions.set"), 'Bounded ordinary fallback must not stage pendingActions');
  assert(!boundedFallbackSegment.includes("actionRequired: true"), 'Bounded ordinary fallback must not emit actionRequired early HITL responses');
  assert(!boundedFallbackSegment.includes("fetchWithTimeout"), 'Bounded ordinary fallback must not call fetchWithTimeout');
  assert(!boundedFallbackSegment.includes("https://google.serper.dev/search"), 'Bounded ordinary fallback must not target Serper search endpoint');
  assert(!boundedFallbackSegment.includes("<embed>"), 'Bounded ordinary fallback must not parse <embed> tags');
  assert(!boundedFallbackSegment.includes("[EXECUTE_OPEN_TAB:"), 'Bounded ordinary fallback must not construct [EXECUTE_OPEN_TAB: links');
  assert(!boundedFallbackSegment.includes("ghostLearn("), 'Bounded ordinary fallback must not invoke ghostLearn');
  assert(!boundedFallbackSegment.includes("INSERT INTO user_memories"), 'Bounded ordinary fallback must not execute INSERT INTO user_memories');

  // Assertion Group 10B: Preserved Ordinary Safeguards, Wrapper, and 4-Field Response in Bounded Segment
  assert(boundedFallbackSegment.includes("const finalRouteExecution = await getLatestExecutionStatus(req);"), 'Bounded ordinary fallback must retain getLatestExecutionStatus(req)');
  assert(boundedFallbackSegment.includes("visitorBannedPatterns"), 'Bounded ordinary fallback must retain visitorBannedPatterns screening');
  assert(boundedFallbackSegment.includes("falseClaimPatterns"), 'Bounded ordinary fallback must retain falseClaimPatterns screening');
  assert(boundedFallbackSegment.includes("const ordinaryReceipt = createRouteReceipt('ordinary_no_action_evidence');"), 'Bounded ordinary fallback must construct ordinary receipt');
  assert(boundedFallbackSegment.includes("replyText = applyEvidenceWrapper(replyText, ordinaryReceipt);"), 'Bounded ordinary fallback must apply evidence wrapper to replyText');
  assert(boundedFallbackSegment.includes("userHistory.push({ role: 'user', content: message }, { role: 'assistant', content: replyText.trim() });"), 'Bounded ordinary fallback must update in-session userHistory');
  assert(boundedFallbackSegment.includes("if (userHistory.length > maxMemory) userHistory = userHistory.slice(-maxMemory);"), 'Bounded ordinary fallback must bound userHistory slice');
  assert(boundedFallbackSegment.includes("res.json({ success: true, text: replyText.trim(), runId: typeof currentRun !== 'undefined' && currentRun ? currentRun.runId : undefined, execution: finalRouteExecution });"), 'Bounded ordinary fallback must emit standard 4-field response');
  assert(!boundedFallbackSegment.includes("receipt:"), 'Bounded ordinary fallback must not serialize receipt in response object');

  // --- Category 11: Client Chat Deadline Alignment ---
  const uiPath = path.join(__dirname, '..', 'public', 'ghost-ui.js');
  assert(fs.existsSync(uiPath), 'public/ghost-ui.js must exist');
  const ghostUiSource = fs.readFileSync(uiPath, 'utf8');

  assert(ghostUiSource.includes("const controller = new AbortController();"), 'ghost-ui.js must instantiate AbortController');
  assert(ghostUiSource.includes("const timeoutId = setTimeout(() => controller.abort(), 60000);"), 'ghost-ui.js must set 60000ms client timeout');
  assert(!ghostUiSource.includes("const timeoutId = setTimeout(() => controller.abort(), 20000);"), 'ghost-ui.js must not retain 20000ms client timeout');
  assert(ghostUiSource.includes("fetch(apiUrl('/api/chat')"), 'ghost-ui.js must target /api/chat endpoint');
  assert(ghostUiSource.includes("signal: controller.signal"), 'ghost-ui.js must pass controller.signal to fetch');
  assert(ghostUiSource.includes("clearTimeout(timeoutId)"), 'ghost-ui.js must clear timeoutId on completion/error');
  assert(ghostUiSource.includes("appendMessage('ghost', \"Response timed out. You can continue typing.\");"), 'ghost-ui.js must preserve exact AbortError timeout message');

  console.log('ALL GHOST SKILLS V0 STATIC AND LOGICAL TESTS PASSED.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
