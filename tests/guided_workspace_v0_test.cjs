'use strict';
const fs = require('fs');
const assert = require('assert');

console.log('--- GUIDED WORKSPACE V0 STATIC-SOURCE REGRESSION ---');
console.log('Static-source coverage only. Does NOT prove runtime authentication, browser behavior, server authorization, or chat execution.');
console.log('');

const indexHtml = fs.readFileSync('public/index.html', 'utf8');
const uiJs      = fs.readFileSync('public/ghost-ui.js', 'utf8');

// 1. Existing Workspace navigation is reused and Guided Workspace heading exists
assert(indexHtml.includes('id="navPersonalCoreBtn"'), 'FAIL [1]: navPersonalCoreBtn absent in HTML');
assert(uiJs.includes('navPersonalCoreBtn'), 'FAIL [1]: navPersonalCoreBtn absent in UI JS');
assert(uiJs.includes('Guided Workspace'), 'FAIL [1]: Guided Workspace heading absent in UI JS');
assert(uiJs.includes('renderGuidedWorkspace'), 'FAIL [1]: renderGuidedWorkspace function absent in UI JS');

// 2. All 5 exact owner-card headings and their plain-language limits exist
assert(uiJs.includes('My Tasks'), 'FAIL [2]: My Tasks card title absent');
assert(uiJs.includes('View your saved pending and planned work.'), 'FAIL [2]: My Tasks description absent');

assert(uiJs.includes('My Goals'), 'FAIL [2]: My Goals card title absent');
assert(uiJs.includes('Review the goals currently guiding this workspace.'), 'FAIL [2]: My Goals description absent');

assert(uiJs.includes('Research a Topic'), 'FAIL [2]: Research a Topic card title absent');
assert(uiJs.includes('Ask Ghost for a bounded, cited news or research briefing.'), 'FAIL [2]: Research description absent');

assert(uiJs.includes('Clear This Chat Context'), 'FAIL [2]: Clear This Chat Context card title absent');
assert(uiJs.includes('Remove only temporary chat context for this session. Tasks, goals, files, and Personal Core memories stay unchanged.'), 'FAIL [2]: Clear Context description absent');

assert(uiJs.includes('Control Center'), 'FAIL [2]: Control Center card title absent');
assert(uiJs.includes('Open the owner-only screen for the two existing approval-gated checks. No test runs automatically.'), 'FAIL [2]: Control Center description absent');

// 3. Four frozen composer phrases exist in GUIDED_STARTER_MAP with exactly four approved keys
assert(uiJs.includes('const GUIDED_STARTER_MAP = Object.freeze({'), 'FAIL [3]: frozen GUIDED_STARTER_MAP absent');
const mapStart = uiJs.indexOf('const GUIDED_STARTER_MAP = Object.freeze({');
const mapEnd = uiJs.indexOf('});', mapStart);
assert(mapEnd !== -1, 'FAIL [3]: GUIDED_STARTER_MAP closing brace absent');
const mapBody = uiJs.substring(mapStart, mapEnd + 3);

assert(mapBody.includes("my_tasks: 'what are my tasks?'"), 'FAIL [3]: my_tasks mapping absent or wrong');
assert(mapBody.includes("my_goals: 'show me my goals'"), 'FAIL [3]: my_goals mapping absent or wrong');
assert(mapBody.includes("research_topic: 'research a topic'"), 'FAIL [3]: research_topic mapping absent or wrong');
assert(mapBody.includes("clear_context: 'clear chat context'"), 'FAIL [3]: clear_context mapping absent or wrong');

const mapKeys = mapBody.match(/^\s+\w+:/gm) || [];
assert(mapKeys.length === 4, `FAIL [3]: GUIDED_STARTER_MAP must have exactly 4 keys, found ${mapKeys.length}`);

assert(uiJs.includes('Object.prototype.hasOwnProperty.call(GUIDED_STARTER_MAP, key)'), 'FAIL [3]: hasOwnProperty check absent for GUIDED_STARTER_MAP');

// 4. Composer-starter handler is strictly bounded
const starterHandlerStart = uiJs.indexOf('starterBtns.forEach(');
assert(starterHandlerStart !== -1, 'FAIL [4]: starterBtns click listener loop absent');
const starterHandlerEnd = uiJs.indexOf('});', starterHandlerStart + 20);
const starterHandlerBody = uiJs.substring(starterHandlerStart, starterHandlerEnd + 3);

assert(!starterHandlerBody.includes('fetch('), 'FAIL [4]: starter handler must not call fetch(');
assert(!starterHandlerBody.includes('/api/chat'), 'FAIL [4]: starter handler must not reference /api/chat');
assert(!starterHandlerBody.includes('submitComposer'), 'FAIL [4]: starter handler must not call submitComposer');
assert(!starterHandlerBody.includes('processCommand'), 'FAIL [4]: starter handler must not call processCommand');
assert(!starterHandlerBody.includes('apiUrl'), 'FAIL [4]: starter handler must not call apiUrl');
assert(!starterHandlerBody.includes('sendControlCenterRequest'), 'FAIL [4]: starter handler must not call sendControlCenterRequest');
assert(!starterHandlerBody.includes('clearHistory'), 'FAIL [4]: starter handler must not call clearHistory');

// 5. Research and Clear Context cards state owner must explicitly send from normal chat
assert(uiJs.includes('explicitly send the request from normal chat'), 'FAIL [5]: Research card explicit send text absent');
assert(uiJs.includes('context is not cleared until you explicitly send from normal chat'), 'FAIL [5]: Clear Context card explicit send text absent');

// 6. Control Center card calls only openControlCenter()
const ccCardBtnIdx = uiJs.indexOf("chatLog.querySelector('.guided-cc-btn')");
assert(ccCardBtnIdx !== -1, 'FAIL [6]: guided-cc-btn selector absent');
const ccCardBody = uiJs.substring(ccCardBtnIdx, ccCardBtnIdx + 300);
assert(ccCardBody.includes('openControlCenter()'), 'FAIL [6]: CC card button must call openControlCenter()');
assert(!ccCardBody.includes('refreshControlCenter'), 'FAIL [6]: CC card button must not call refreshControlCenter');
assert(!ccCardBody.includes('sendControlCenterRequest'), 'FAIL [6]: CC card button must not call sendControlCenterRequest');

// 7. Owner/visitor presentation conditions exist, visitor view has no private terms
const guidedFnIdx = uiJs.indexOf('function renderGuidedWorkspace()');
assert(guidedFnIdx !== -1, 'FAIL [7]: renderGuidedWorkspace function absent');
const guidedFnEnd = uiJs.indexOf('// --- CONTROL CENTER V0 WIRING ---', guidedFnIdx);
const guidedFnBody = uiJs.substring(guidedFnIdx, guidedFnEnd !== -1 ? guidedFnEnd : guidedFnIdx + 2500);

assert(guidedFnBody.includes('if (!isAdminMode)'), 'FAIL [7]: isAdminMode check absent in renderGuidedWorkspace');
const visitorBlockStart = guidedFnBody.indexOf('if (!isAdminMode)');
const visitorBlockEnd = guidedFnBody.indexOf('return;', visitorBlockStart);
const visitorBlock = guidedFnBody.substring(visitorBlockStart, visitorBlockEnd);

assert(!visitorBlock.includes('My Tasks'), 'FAIL [7]: visitor view must not contain My Tasks');
assert(!visitorBlock.includes('My Goals'), 'FAIL [7]: visitor view must not contain My Goals');
assert(!visitorBlock.includes('Clear This Chat Context'), 'FAIL [7]: visitor view must not contain Clear This Chat Context');
assert(!visitorBlock.includes('Control Center'), 'FAIL [7]: visitor view must not contain Control Center');
assert(!visitorBlock.includes('approval-gated'), 'FAIL [7]: visitor view must not contain approval-gated');
assert(!visitorBlock.includes('Personal Core'), 'FAIL [7]: visitor view must not contain Personal Core');

// 8. No forbidden legacy/dangerous features added to UI JS
const forbidden = ['getUserMedia', 'SpeechRecognition', 'speechSynthesis', 'MediaRecorder', 'webkitSpeechRecognition'];
for (const term of forbidden) {
    assert(!uiJs.includes(term), `FAIL [8]: forbidden term ${term} found in UI JS`);
}

// 9. Existing normal-chat and Control Center identifiers remain present
assert(uiJs.includes('renderWelcomeCard'), 'FAIL [9]: renderWelcomeCard identifier missing');
assert(uiJs.includes('openControlCenter'), 'FAIL [9]: openControlCenter identifier missing');
assert(uiJs.includes('isAdminMode'), 'FAIL [9]: isAdminMode identifier missing');
assert(uiJs.includes('userInput'), 'FAIL [9]: userInput identifier missing');

// 10. Guided composer shortcuts strip exists in HTML directly after input-bar
assert(indexHtml.includes('id="guidedComposerShortcuts"'), 'FAIL [10]: guidedComposerShortcuts container absent in HTML');
assert(indexHtml.includes('aria-label="Guided shortcuts"'), 'FAIL [10]: aria-label for guidedComposerShortcuts absent');
assert(/id="guidedComposerShortcuts"[^>]*style="[^"]*display:\s*none/.test(indexHtml), 'FAIL [10]: guidedComposerShortcuts must be hidden by default in HTML');

const inputBarIdx = indexHtml.indexOf('class="input-bar"');
const inputBarClose = indexHtml.indexOf('</div>', inputBarIdx);
const shortcutsIdx = indexHtml.indexOf('id="guidedComposerShortcuts"');
assert(shortcutsIdx > inputBarClose, 'FAIL [10]: guidedComposerShortcuts must exist after input-bar');

const shortcutMatches = indexHtml.match(/class="[^"]*guided-composer-shortcut-btn[^"]*"/g) || [];
assert(shortcutMatches.length === 3, `FAIL [10]: must have exactly 3 shortcut buttons, found ${shortcutMatches.length}`);
assert(indexHtml.includes('data-guidedkey="my_tasks"'), 'FAIL [10]: my_tasks shortcut button absent');
assert(indexHtml.includes('data-guidedkey="my_goals"'), 'FAIL [10]: my_goals shortcut button absent');
assert(indexHtml.includes('data-guidedkey="research_topic"'), 'FAIL [10]: research_topic shortcut button absent');
assert(!indexHtml.includes('data-guidedkey="clear_context"'), 'FAIL [10]: clear_context must not be in composer shortcuts');

// 11. Helper and map key reuse in JS
assert(uiJs.includes('populateGuidedStarter'), 'FAIL [11]: populateGuidedStarter helper absent');
assert(uiJs.includes('guidedComposerShortcuts'), 'FAIL [11]: guidedComposerShortcuts reference absent in UI JS');

// 12. Owner/visitor visibility includes the strip
let setOwnerStart = uiJs.indexOf('function setOwnerHeader(');
let setOwnerOpen = uiJs.indexOf('{', setOwnerStart);
let setOwnerDepth = 0, setOwnerEnd = setOwnerOpen;
for (let i = setOwnerOpen; i < uiJs.length; i++) {
    if (uiJs[i] === '{') setOwnerDepth++;
    else if (uiJs[i] === '}') {
        setOwnerDepth--;
        if (setOwnerDepth === 0) { setOwnerEnd = i; break; }
    }
}
const setOwnerBody = uiJs.substring(setOwnerStart, setOwnerEnd + 1);
assert(setOwnerBody.includes('guidedComposerShortcuts'), 'FAIL [12]: setOwnerHeader must include guidedComposerShortcuts');
assert(setOwnerBody.includes("guidedShortcuts.style.display = 'flex'"), 'FAIL [12]: setOwnerHeader must show guidedComposerShortcuts');

let setVisitorStart = uiJs.indexOf('function setVisitorHeader(');
let setVisitorOpen = uiJs.indexOf('{', setVisitorStart);
let setVisitorDepth = 0, setVisitorEnd = setVisitorOpen;
for (let i = setVisitorOpen; i < uiJs.length; i++) {
    if (uiJs[i] === '{') setVisitorDepth++;
    else if (uiJs[i] === '}') {
        setVisitorDepth--;
        if (setVisitorDepth === 0) { setVisitorEnd = i; break; }
    }
}
const setVisitorBody = uiJs.substring(setVisitorStart, setVisitorEnd + 1);
assert(setVisitorBody.includes('guidedComposerShortcuts'), 'FAIL [12]: setVisitorHeader must include guidedComposerShortcuts');
assert(setVisitorBody.includes("guidedShortcuts.style.display = 'none'"), 'FAIL [12]: setVisitorHeader must hide guidedComposerShortcuts');

// 13. Prohibit fixed/overlay rules for composer shortcuts
assert(!indexHtml.includes('position: fixed;'), 'FAIL [13]: composer shortcuts must not use position: fixed in HTML');

// 14. Scoped shortcut handler has no request/send/clear/control-center primitives
const shortcutHandlerIdx = uiJs.indexOf('composerShortcutBtns.forEach(');
assert(shortcutHandlerIdx !== -1, 'FAIL [14]: composerShortcutBtns listener loop absent');
const shortcutHandlerEnd = uiJs.indexOf('});', shortcutHandlerIdx + 20);
const shortcutHandlerBody = uiJs.substring(shortcutHandlerIdx, shortcutHandlerEnd + 3);

assert(!shortcutHandlerBody.includes('fetch('), 'FAIL [14]: shortcut handler must not call fetch');
assert(!shortcutHandlerBody.includes('/api/chat'), 'FAIL [14]: shortcut handler must not reference /api/chat');
assert(!shortcutHandlerBody.includes('sendBtn.click'), 'FAIL [14]: shortcut handler must not click sendBtn');
assert(!shortcutHandlerBody.includes('submitComposer'), 'FAIL [14]: shortcut handler must not call submitComposer');
assert(!shortcutHandlerBody.includes('processCommand'), 'FAIL [14]: shortcut handler must not call processCommand');
assert(!shortcutHandlerBody.includes('clearHistory'), 'FAIL [14]: shortcut handler must not call clearHistory');
assert(!shortcutHandlerBody.includes('openControlCenter'), 'FAIL [14]: shortcut handler must not call openControlCenter');
assert(!shortcutHandlerBody.includes('prepare'), 'FAIL [14]: shortcut handler must not reference prepare');
assert(!shortcutHandlerBody.includes('confirm'), 'FAIL [14]: shortcut handler must not reference confirm');
assert(!shortcutHandlerBody.includes('cancel'), 'FAIL [14]: shortcut handler must not reference cancel');
assert(!shortcutHandlerBody.includes('setInterval'), 'FAIL [14]: shortcut handler must not call setInterval');
assert(!shortcutHandlerBody.includes('setTimeout'), 'FAIL [14]: shortcut handler must not call setTimeout');

console.log('PASS All static-source regression assertions passed.');
console.log('');
console.log('This test proves source-level structure only.');
console.log('It does NOT prove runtime authentication, browser behavior, server authorization, or chat execution.');
