'use strict';
const fs = require('fs');
const assert = require('assert');

console.log('Static-source coverage only. It does NOT prove runtime authentication, browser behavior, or test execution.');
console.log('');

const serverJs  = fs.readFileSync('server.js', 'utf8');
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
const uiJs      = fs.readFileSync('public/ghost-ui.js', 'utf8');
const runnerJs  = fs.readFileSync('services/approvedTestRunner.js', 'utf8');

// ── Helpers ────────────────────────────────────────────────────────────────

// Return src[startMarker .. first endMarker after startMarker)
function bounded(src, startMarker, endMarker) {
    const si = src.indexOf(startMarker);
    if (si === -1) return null;
    const ei = src.indexOf(endMarker, si + startMarker.length);
    if (ei === -1) return null;
    return src.substring(si, ei);
}

// Count non-overlapping occurrences
function countOcc(str, needle) {
    let n = 0, pos = 0;
    while ((pos = str.indexOf(needle, pos)) !== -1) { n++; pos += needle.length; }
    return n;
}

// Balanced-brace scan: extract every `return res.json({...})` object
// body from region via balanced-brace counting.
function extractResJsonObjs(region) {
    const results = [];
    const needle = 'return res.json({';
    let pos = 0;
    while (true) {
        const hit = region.indexOf(needle, pos);
        if (hit === -1) break;
        const objOpen = hit + needle.length - 1; // position of the opening {
        let depth = 0, i = objOpen;
        while (i < region.length) {
            const ch = region[i];
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) break; }
            i++;
        }
        results.push(region.substring(objOpen, i + 1));
        pos = i + 1;
    }
    return results;
}

// Verify a bounded branch has authenticateOwner, at least one res.json object,
// and every object has all four required top-level keys with no runId: undefined.
function assertBranchResponses(region, label) {
    assert(region !== null, `FAIL [${label}]: could not bound branch region`);
    assert(region.includes('authenticateOwner(req)'), `FAIL [${label}]: authenticateOwner(req) absent`);
    const objs = extractResJsonObjs(region);
    assert(objs.length > 0, `FAIL [${label}]: no return res.json objects found`);
    for (let idx = 0; idx < objs.length; idx++) {
        const obj = objs[idx];
        const loc = `${label} obj[${idx}]`;
        assert(obj.includes('success:'),   `FAIL [${loc}]: missing 'success' field`);
        assert(obj.includes('text:'),      `FAIL [${loc}]: missing 'text' field`);
        assert(obj.includes('runId:'),     `FAIL [${loc}]: missing 'runId' field`);
        assert(obj.includes('execution:'), `FAIL [${loc}]: missing 'execution' field`);
        assert(!obj.includes('runId: undefined'), `FAIL [${loc}]: must not use runId: undefined`);
    }
}

// ── 1. Truthful Initial Queue State ────────────────────────────────────────

const REQUIRED_QUEUE_COPY = 'Queue not loaded. Select Refresh to request the current owner-safe queue.';
assert(indexHtml.includes('id="ccApprovalQueueData"'), 'FAIL [1]: ccApprovalQueueData element absent in HTML');
assert(indexHtml.includes('>' + REQUIRED_QUEUE_COPY + '</div>'), 'FAIL [1]: ccApprovalQueueData must contain exact required neutral copy');
const ccQueueStart = indexHtml.indexOf('id="ccApprovalQueueData"');
const ccQueueEnd   = indexHtml.indexOf('</div>', ccQueueStart);
assert(!indexHtml.substring(ccQueueStart, ccQueueEnd).includes('Loading...'), 'FAIL [1]: Loading... must be absent from ccApprovalQueueData element');

// ── 2. Per-Response-Object Four-Field Contract ──────────────────────────────

// Each branch is bounded by its start marker and the immediately following
// distinct marker that begins the next named branch.

// queue: isApprovalQueueIntent → isPrepareSessionIntent
assertBranchResponses(
    bounded(serverJs, 'isApprovalQueueIntent', 'isPrepareSessionIntent'),
    'queue'
);

// prepare: isPrepareSessionIntent → isConfirmTestIntent
assertBranchResponses(
    bounded(serverJs, 'isPrepareSessionIntent', 'isConfirmTestIntent'),
    'prepare'
);

// confirm: isConfirmTestIntent → isCancelTestIntent
assertBranchResponses(
    bounded(serverJs, 'isConfirmTestIntent', 'isCancelTestIntent'),
    'confirm'
);

// cancel: isCancelTestIntent → isClearContextIntent (the immediately following
// named intent; this keeps the extracted region tight to the cancel branch only)
assertBranchResponses(
    bounded(serverJs, 'isCancelTestIntent', 'isClearContextIntent'),
    'cancel'
);

// Near-miss branch
const nearMissIdx   = serverJs.indexOf('isNearMissTest =');
const brainIdx      = serverJs.indexOf('await brain.think(');
assert(nearMissIdx !== -1 && nearMissIdx < brainIdx, 'FAIL [2]: near-miss branch must exist before await brain.think(');
assert(serverJs.includes('No LLM workflow was triggered'), 'FAIL [2]: near-miss fixed guidance text absent');
// Extract near-miss block: isNearMissTest → the console.log immediately after its closing brace
const nearMissRegion = bounded(serverJs, 'isNearMissTest =', 'await brain.think(');
assert(nearMissRegion !== null, 'FAIL [2]: could not bound near-miss region');
const nearMissObjs = extractResJsonObjs(nearMissRegion);
assert(nearMissObjs.length > 0, 'FAIL [2]: no res.json object found in near-miss branch');
assert(nearMissObjs[0].includes('runId: null,'), 'FAIL [2]: near-miss response must use literal runId: null');

// ── 3. Two Fixed Test Keys Only ─────────────────────────────────────────────

const ccWiringStart = uiJs.indexOf('// --- CONTROL CENTER V0 WIRING ---');
assert(ccWiringStart !== -1, 'FAIL [3]: CC wiring block marker absent');
const ccWiringBlock = uiJs.substring(ccWiringStart);

// Parse CC_PREPARE_MAP object body with balanced-brace scan
const ccMapMarker   = 'const CC_PREPARE_MAP = Object.freeze({';
const ccMapHit      = ccWiringBlock.indexOf(ccMapMarker);
assert(ccMapHit !== -1, 'FAIL [3]: CC_PREPARE_MAP Object.freeze absent');
{
    const ccMapOpenBrace = ccMapHit + ccMapMarker.length - 1;
    let depth = 0, i = ccMapOpenBrace;
    while (i < ccWiringBlock.length) {
        const ch = ccWiringBlock[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const ccMapBody = ccWiringBlock.substring(ccMapOpenBrace, i + 1);
    assert(ccMapBody.includes("session_context: 'prepare test: session context'"), "FAIL [3]: CC_PREPARE_MAP session_context value wrong or absent");
    assert(ccMapBody.includes("golden_baseline: 'prepare test: golden baseline'"), "FAIL [3]: CC_PREPARE_MAP golden_baseline value wrong or absent");
    const keyMatches = ccMapBody.match(/^\s+\w+:/gm) || [];
    assert(keyMatches.length === 2, `FAIL [3]: CC_PREPARE_MAP must have exactly 2 keys, found ${keyMatches.length}`);
}

// Two hasOwnProperty guard call sites
assert(ccWiringBlock.includes('Object.prototype.hasOwnProperty.call(CC_PREPARE_MAP, testKey)'), 'FAIL [3]: hasOwnProperty check before local selection absent');
assert(ccWiringBlock.includes('Object.prototype.hasOwnProperty.call(CC_PREPARE_MAP, currentSelectedTestKey)'), 'FAIL [3]: hasOwnProperty check before confirm-prepare send absent');

// Runner allowlist — parse its object body with balanced-brace scan
const runnerAllowlistMarker = 'const ALLOWLIST = {';
const runnerAllowlistHit    = runnerJs.indexOf(runnerAllowlistMarker);
assert(runnerAllowlistHit !== -1, 'FAIL [3]: ALLOWLISTED_TESTS constant absent in runner');
{
    const runnerAllowlistOpen = runnerJs.indexOf('{', runnerAllowlistHit);
    assert(runnerAllowlistOpen !== -1, 'FAIL [3]: ALLOWLISTED_TESTS opening brace absent');
    let depth = 0, i = runnerAllowlistOpen;
    while (i < runnerJs.length) {
        const ch = runnerJs[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    const runnerBody = runnerJs.substring(runnerAllowlistOpen, i + 1);
    assert(runnerBody.includes("'session_context': 'tests/session_context_v0_test.cjs'"), "FAIL [3]: runner allowlist session_context path wrong or absent");
    assert(runnerBody.includes("'golden_baseline': 'tests/golden_regression_v0_test.cjs'"), "FAIL [3]: runner allowlist golden_baseline path wrong or absent");
    const runnerKeyMatches = runnerBody.match(/^\s+'[\w_]+':/gm) || [];
    assert(runnerKeyMatches.length === 2, `FAIL [3]: runner allowlist must have exactly 2 keys, found ${runnerKeyMatches.length}`);
}
assert(runnerJs.includes('process.execPath'), 'FAIL [3]: runner must use process.execPath');
assert(runnerJs.includes('shell: false'),     'FAIL [3]: runner must set shell: false');
assert(runnerJs.includes('timeout: 30000'),   'FAIL [3]: runner timeout must be 30000');
assert(runnerJs.includes('maxBuffer: 2048'),  'FAIL [3]: runner maxBuffer must be 2048');

// ── 4. Explicit-only UI Request Behavior ───────────────────────────────────

// openControlCenter body
const openFnIdx = ccWiringBlock.indexOf('function openControlCenter()');
assert(openFnIdx !== -1, 'FAIL [4]: openControlCenter absent');
const openFnBody = ccWiringBlock.substring(openFnIdx, ccWiringBlock.indexOf('\n    }', openFnIdx) + 6);
assert(!openFnBody.includes('refreshControlCenter'), 'FAIL [4]: openControlCenter must not reference refreshControlCenter');
assert(!openFnBody.includes('sendControlCenterRequest'), 'FAIL [4]: openControlCenter must not reference sendControlCenterRequest');

// 'show my approval queue' only inside refreshControlCenter
const SHOW_QUEUE   = "sendControlCenterRequest('show my approval queue')";
const refreshFnIdx = ccWiringBlock.indexOf('async function refreshControlCenter()');
assert(refreshFnIdx !== -1, 'FAIL [4]: refreshControlCenter absent');
const refreshFnBody = ccWiringBlock.substring(refreshFnIdx, ccWiringBlock.indexOf('\n    }', refreshFnIdx) + 6);
assert(refreshFnBody.includes(SHOW_QUEUE), 'FAIL [4]: show my approval queue must be inside refreshControlCenter');
assert(!ccWiringBlock.substring(0, refreshFnIdx).includes(SHOW_QUEUE), 'FAIL [4]: show my approval queue must not appear before refreshControlCenter');

// refreshControlCenter() invoked only from ccRefreshBtn listener
const ccRefreshBlockStart = ccWiringBlock.indexOf('if (ccRefreshBtn) {');
assert(ccRefreshBlockStart !== -1, 'FAIL [4]: ccRefreshBtn listener block absent');
const ccRefreshBlockBody = ccWiringBlock.substring(ccRefreshBlockStart, ccWiringBlock.indexOf('\n    }', ccRefreshBlockStart) + 6);
assert(ccRefreshBlockBody.includes('refreshControlCenter()'), 'FAIL [4]: ccRefreshBtn listener must invoke refreshControlCenter()');
const ccWiringStripped = ccWiringBlock.replace(refreshFnBody, '').replace(ccRefreshBlockBody, '');
assert(!ccWiringStripped.includes('refreshControlCenter()'), 'FAIL [4]: refreshControlCenter() invoked outside its definition and ccRefreshBtn listener');

// Neutral copy in prepare, confirm, and cancel handlers (at least 3 occurrences)
const NEUTRAL = 'Use Refresh to view the current owner-safe queue.';
assert(countOcc(ccWiringBlock, NEUTRAL) >= 3, 'FAIL [4]: neutral copy must appear in prepare, confirm, and cancel handlers');

// Request body
assert(ccWiringBlock.includes('body: JSON.stringify({ message })'), 'FAIL [4]: CC request body must be exactly JSON.stringify({ message })');

// sendControlCenterRequest catch must not expose e.message
const sendCCFnIdx = ccWiringBlock.indexOf('async function sendControlCenterRequest(');
assert(sendCCFnIdx !== -1, 'FAIL [4]: sendControlCenterRequest absent');
const sendCCBody  = ccWiringBlock.substring(sendCCFnIdx, ccWiringBlock.indexOf('\n    }', sendCCFnIdx) + 6);
assert(!sendCCBody.includes('e.message'), 'FAIL [4]: sendControlCenterRequest catch must not expose e.message');

// No proposalId, raw child output, or internal test paths in CC wiring
assert(!ccWiringBlock.includes('proposalId'), 'FAIL [4]: proposalId must not appear in CC wiring block');
assert(!ccWiringBlock.includes('session_context_v0_test'), 'FAIL [4]: internal test path session_context_v0_test must not appear in CC wiring');
assert(!ccWiringBlock.includes('golden_regression_v0_test'), 'FAIL [4]: internal test path golden_regression_v0_test must not appear in CC wiring');

// ── 5. Actions Menu and Presentation Regression ────────────────────────────

// CC button hidden by default in HTML
assert(/id="controlCenterBtn"[^>]*style="[^"]*display:\s*none/.test(indexHtml), 'FAIL [5]: controlCenterBtn must be hidden by default in HTML');

// setOwnerHeader shows it
assert(uiJs.includes("ccBtn.style.display = ''"), 'FAIL [5]: setOwnerHeader must show CC button');

// setVisitorHeader hides button + modal + clears key
const visitorFnIdx  = uiJs.indexOf('function setVisitorHeader(');
assert(visitorFnIdx !== -1, 'FAIL [5]: setVisitorHeader absent');
const visitorFnBody = uiJs.substring(visitorFnIdx, uiJs.indexOf('\n    }', visitorFnIdx) + 6);
assert(visitorFnBody.includes("ccBtn.style.display = 'none'"),  'FAIL [5]: setVisitorHeader must hide CC button');
assert(visitorFnBody.includes("ccModal.style.display = 'none'"), 'FAIL [5]: setVisitorHeader must hide CC modal');
assert(visitorFnBody.includes('currentSelectedTestKey = null'),  'FAIL [5]: setVisitorHeader must clear currentSelectedTestKey');

// controlCenterBtn click listener calls openControlCenter()
const ccBtnListenerIdx = ccWiringBlock.indexOf("controlCenterBtn.addEventListener('click'");
assert(ccBtnListenerIdx !== -1, 'FAIL [5]: controlCenterBtn click listener absent');
const ccBtnBody = ccWiringBlock.substring(ccBtnListenerIdx, ccWiringBlock.indexOf('\n    }', ccBtnListenerIdx) + 6);
assert(ccBtnBody.includes('openControlCenter()'), 'FAIL [5]: controlCenterBtn click must call openControlCenter()');

// newChatBtn bounded listener
const newChatBlockIdx = uiJs.indexOf('if (newChatBtn) {');
assert(newChatBlockIdx !== -1, 'FAIL [5]: newChatBtn existence guard absent');
const newChatBlock = uiJs.substring(newChatBlockIdx, uiJs.indexOf('\n    }', newChatBlockIdx) + 6);
assert(newChatBlock.includes("newChatBtn.addEventListener('click'"), 'FAIL [5]: newChatBtn addEventListener absent');
assert(newChatBlock.includes('renderWelcomeCard(masterUser)'), 'FAIL [5]: newChatBtn must call renderWelcomeCard(masterUser)');
assert(newChatBlock.includes('closeWorkspaceActions()'), 'FAIL [5]: newChatBtn must call closeWorkspaceActions()');
assert(!newChatBlock.includes('fetch('), 'FAIL [5]: newChatBtn must not call fetch(');
assert(!newChatBlock.includes('/api/chat'), 'FAIL [5]: newChatBtn must not reference /api/chat');
assert(!newChatBlock.includes('clearHistory'), 'FAIL [5]: newChatBtn must not call clearHistory');
assert(!newChatBlock.includes('clear chat context'), 'FAIL [5]: newChatBtn must not contain clear chat context phrase');
assert(!newChatBlock.includes('approval queue'), 'FAIL [5]: newChatBtn must not reference approval queue');

// Responsive grid
assert(indexHtml.includes('repeat(auto-fit, minmax('), 'FAIL [5]: responsive CC grid declaration absent');

// Focus on open, focus return on close, Escape
assert(uiJs.includes('ccCloseBtn.focus()'), 'FAIL [5]: focus on ccCloseBtn on open absent');
assert(uiJs.includes('_ccOpenerBtn.focus()'), 'FAIL [5]: focus return to opener absent');
const windowKdIdx = uiJs.indexOf("window.addEventListener('keydown'");
assert(windowKdIdx !== -1, 'FAIL [5]: window keydown listener absent');
const windowKdBody = uiJs.substring(windowKdIdx, windowKdIdx + 600);
assert(windowKdBody.includes("e.key === 'Escape'"), 'FAIL [5]: Escape handler absent in window keydown');
assert(windowKdBody.includes('closeControlCenter()'), 'FAIL [5]: Escape must call closeControlCenter()');
assert(!windowKdBody.includes("ccModalEl.style.display = 'none'"), 'FAIL [5]: Escape must not directly mutate ccModalEl.style.display');

// Tab containment
assert(uiJs.includes("if (e.key !== 'Tab') return"), 'FAIL [5]: Tab containment guard absent');

// ── 6. Behavioral Unit Test for approvedTestRunner ─────────────────────────
(async () => {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const runner = await import(pathToFileURL(path.resolve('services/approvedTestRunner.js')).href);

    const ownerActive = 'test_owner_active_' + Date.now();
    const ownerExpired = 'test_owner_expired_' + Date.now();
    const ownerA = 'test_owner_A_' + Date.now();
    const ownerB = 'test_owner_B_' + Date.now();
    const ownerConsumed = 'test_owner_consumed_' + Date.now();

    // 1. Active proposal can be cancelled once (true) and is then absent
    const pActive = runner.createProposal(ownerActive, 'session_context');
    assert(pActive !== null, 'FAIL [6]: createProposal failed for active owner');
    const cancelActiveResult = runner.cancelProposal(ownerActive);
    assert(cancelActiveResult === true, 'FAIL [6]: active proposal cancellation must return true');
    const cancelActiveSecond = runner.cancelProposal(ownerActive);
    assert(cancelActiveSecond === false, 'FAIL [6]: second cancellation must return false');
    assert(runner.getPendingProposalSnapshot(ownerActive) === null, 'FAIL [6]: proposal must be absent after cancel');

    // 2. Expired proposal cancellation clears stale entry but returns false
    const origNow = Date.now;
    try {
        const pExp = runner.createProposal(ownerExpired, 'session_context');
        assert(pExp !== null, 'FAIL [6]: createProposal failed for expired owner');
        Date.now = () => origNow() + 6 * 60 * 1000;
        const cancelExpResult = runner.cancelProposal(ownerExpired);
        assert(cancelExpResult === false, 'FAIL [6]: expired proposal cancellation must return false');
        assert(runner.getPendingProposalSnapshot(ownerExpired) === null, 'FAIL [6]: stale entry must be cleared after cancel');
    } finally {
        Date.now = origNow;
    }

    // 3. Cancelling owner A's proposal does not remove owner B's separate active proposal
    const pA = runner.createProposal(ownerA, 'session_context');
    const pB = runner.createProposal(ownerB, 'golden_baseline');
    assert(pA !== null && pB !== null, 'FAIL [6]: createProposal failed for ownerA or ownerB');
    const cancelAResult = runner.cancelProposal(ownerA);
    assert(cancelAResult === true, 'FAIL [6]: ownerA proposal cancellation must return true');
    const snapB = runner.getPendingProposalSnapshot(ownerB);
    assert(snapB !== null, 'FAIL [6]: ownerB proposal must remain active after ownerA cancellation');
    const cancelBResult = runner.cancelProposal(ownerB);
    assert(cancelBResult === true, 'FAIL [6]: ownerB proposal cancellation must return true');

    // 4. After consumeProposal(ownerId), cancellation returns false
    const pCon = runner.createProposal(ownerConsumed, 'session_context');
    assert(pCon !== null, 'FAIL [6]: createProposal failed for consumed owner');
    const consumedKey = runner.consumeProposal(ownerConsumed);
    assert(consumedKey === 'session_context', 'FAIL [6]: consumeProposal should return testKey');
    const cancelConsumedResult = runner.cancelProposal(ownerConsumed);
    assert(cancelConsumedResult === false, 'FAIL [6]: cancellation after consumeProposal must return false');

    console.log('PASS All static-source regression assertions passed.');
    console.log('');
    console.log('This test proves source-level structure only.');
    console.log('It does NOT prove runtime authentication, browser behavior, or test execution.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

