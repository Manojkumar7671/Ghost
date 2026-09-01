const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- CAPABILITY STATUS V0 STATIC-SOURCE REGRESSION ---');
console.log('Static-source coverage only. Does NOT prove runtime authentication, browser behavior, server authorization, or chat execution.\n');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
const uiJsPath = path.join(__dirname, '..', 'public', 'ghost-ui.js');

const indexHtml = fs.readFileSync(indexPath, 'utf8');
const uiJs = fs.readFileSync(uiJsPath, 'utf8');

// Balanced brace extraction helper
function extractFnBody(src, fnName) {
    const startIdx = src.indexOf(`function ${fnName}(`);
    assert(startIdx !== -1, `FAIL: function ${fnName} not found`);
    const openBrace = src.indexOf('{', startIdx);
    assert(openBrace !== -1, `FAIL: opening brace for ${fnName} not found`);
    let depth = 0;
    let endIdx = -1;
    for (let i = openBrace; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) {
                endIdx = i;
                break;
            }
        }
    }
    assert(endIdx !== -1, `FAIL: closing brace for ${fnName} not found`);
    return src.substring(startIdx, endIdx + 1);
}

// 1. HTML elements
const btnMatches = indexHtml.match(/id="capabilityStatusBtn"/g) || [];
assert(btnMatches.length === 1, `FAIL [1]: expected 1 capabilityStatusBtn, found ${btnMatches.length}`);
assert(/id="capabilityStatusBtn"[^>]*style="[^"]*display:\s*none/.test(indexHtml), 'FAIL [1]: capabilityStatusBtn must be hidden by default in HTML');

const modalMatches = indexHtml.match(/id="capabilityStatusModal"/g) || [];
assert(modalMatches.length === 1, `FAIL [1]: expected 1 capabilityStatusModal, found ${modalMatches.length}`);

const closeBtnMatches = indexHtml.match(/id="closeCapabilityStatusBtn"/g) || [];
assert(closeBtnMatches.length === 1, `FAIL [1]: expected 1 closeCapabilityStatusBtn, found ${closeBtnMatches.length}`);

// 2. Fixed catalogue content & footer
const requiredCatalogueItems = [
    { label: 'Available', cap: 'Text chat', copy: 'Responds to messages you explicitly send.' },
    { label: 'Available', cap: 'Owner tasks and goals', copy: 'Shows your saved task and goal views when requested.' },
    { label: 'Available', cap: 'Cited research', copy: 'Runs only after you explicitly send a bounded research request; it does not open articles or browse arbitrary URLs.' },
    { label: 'Needs Approval', cap: 'Allowlisted checks', copy: 'Only the two existing checks may run, and only after a separate expiring owner confirmation.' },
    { label: 'Disabled', cap: 'Automatic fetching', copy: 'No automatic research fetching or background refresh is active.' },
    { label: 'Not Configured', cap: 'Agent coordination', copy: 'No agent fleet, schedule, workflow, or background process is configured.' },
    { label: 'Unsupported', cap: 'High-risk control', copy: 'Browser, Mac/device, terminal, credentials, external messaging, payments, voice, and Hands-Free Mode are not available.' }
];

for (const item of requiredCatalogueItems) {
    assert(uiJs.includes(item.label), `FAIL [2]: label ${item.label} missing in JS`);
    assert(uiJs.includes(item.cap), `FAIL [2]: capability ${item.cap} missing in JS`);
    assert(uiJs.includes(item.copy), `FAIL [2]: copy for ${item.cap} missing in JS`);
}

const footerSentence = 'Status labels are informational only. They do not run, enable, or configure anything.';
assert(indexHtml.includes(footerSentence), 'FAIL [2]: informational footer sentence missing in HTML');

// 3. Visibility logic extracted with balanced brace scanner
const ownerBody = extractFnBody(uiJs, 'setOwnerHeader');
assert(ownerBody.includes('capabilityStatusBtn'), 'FAIL [3]: setOwnerHeader must reference capabilityStatusBtn');
assert(ownerBody.includes("capStatusBtn.style.display = ''"), 'FAIL [3]: setOwnerHeader must show capabilityStatusBtn');

const visitorBody = extractFnBody(uiJs, 'setVisitorHeader');
assert(visitorBody.includes('capabilityStatusBtn'), 'FAIL [3]: setVisitorHeader must reference capabilityStatusBtn');
assert(visitorBody.includes("capStatusBtn.style.display = 'none'"), 'FAIL [3]: setVisitorHeader must hide capabilityStatusBtn');
assert(visitorBody.includes('capabilityStatusModal'), 'FAIL [3]: setVisitorHeader must reference capabilityStatusModal');
assert(visitorBody.includes("capStatusModal.style.display = 'none'"), 'FAIL [3]: setVisitorHeader must hide capabilityStatusModal');

// 4. openCapabilityStatus guard & local behavior
const openFnBody = extractFnBody(uiJs, 'openCapabilityStatus');
assert(openFnBody.includes('if (!isAdminMode) return;'), 'FAIL [4]: openCapabilityStatus must guard with isAdminMode');
assert(openFnBody.includes("modal.style.display = 'flex'"), 'FAIL [4]: openCapabilityStatus must open modal locally');

// 5. closeCapabilityStatus and open/close triggers
const closeFnBody = extractFnBody(uiJs, 'closeCapabilityStatus');
assert(closeFnBody.includes("modal.style.display = 'none'"), 'FAIL [5]: closeCapabilityStatus must hide modal');
assert(closeFnBody.includes('_capStatusOpenerBtn.focus()'), 'FAIL [5]: closeCapabilityStatus must restore focus');

assert(uiJs.includes('openCapabilityStatus(capabilityStatusBtn)'), 'FAIL [5]: click listener must trigger openCapabilityStatus');
assert(uiJs.includes('closeCapabilityStatus()'), 'FAIL [5]: close button and escape must trigger closeCapabilityStatus');

// 6. Prohibited terms scan on Capability Status JS block and HTML modal markup
const statusBlockStart = uiJs.indexOf('let _capStatusOpenerBtn = null;');
const statusBlockEnd = uiJs.indexOf('// --- CONTROL CENTER V0 WIRING ---', statusBlockStart);
const statusJsBlock = uiJs.substring(statusBlockStart, statusBlockEnd);

const modalHtmlStart = indexHtml.indexOf('id="capabilityStatusModal"');
const modalHtmlEnd = indexHtml.indexOf('</div>\n    </div>\n\n    <!-- CONTROL CENTER MODAL -->', modalHtmlStart);
const modalHtml = indexHtml.substring(modalHtmlStart, modalHtmlEnd + 20);

const prohibited = [
    'XMLHttpRequest', 'apiUrl', 'WebSocket', 'EventSource',
    'setInterval', 'setTimeout', 'sendMessage', 'sendBtn', 'clear chat context',
    'prepare', 'confirm', 'cancel', 'refresh', 'runId', 'execution',
    'voice', 'microphone', 'Hands-Free', 'terminal', 'pairing', 'browser',
    'device', 'cron', 'schedule', 'worker', 'webhook', 'retry',
    'companion', 'payment', 'credential', 'secret', 'localStorage'
];

assert(!/\bfetch\s*\(/.test(statusJsBlock), 'FAIL [6]: executable/network fetch call found in Capability Status JS block');
assert(!/\bfetch\s*\(/.test(modalHtml), 'FAIL [6]: executable/network fetch call found in HTML modal markup');

for (const term of prohibited) {
    assert(!statusJsBlock.includes(term), `FAIL [6]: prohibited term "${term}" found in JS block`);
    assert(!modalHtml.includes(term), `FAIL [6]: prohibited term "${term}" found in HTML modal markup`);
}

// Special check for 'agent': allowed strictly inside catalogue text ("No agent fleet...") and title ("Agent coordination")
const agentCountInJs = (statusJsBlock.match(/agent/gi) || []).length;
assert(agentCountInJs === 0, `FAIL [6]: any 'agent' occurrence in the behavior-only JS block fails (count: ${agentCountInJs})`);

console.log('PASS All static-source regression assertions passed.\n');
console.log('This test proves source-level structure only.');
console.log('It does NOT prove runtime authentication, browser behavior, server authorization, or chat execution.');
