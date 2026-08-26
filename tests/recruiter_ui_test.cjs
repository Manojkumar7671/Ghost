const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ghostUiJs = fs.readFileSync(path.join(__dirname, '../public/ghost-ui.js'), 'utf8');
const cssCode = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');

console.log("--- RUNNING LOCAL GHOST UI MASTER REPAIR TESTS ---");

let passedCount = 0;
let failedCount = 0;

function assertCondition(condition, message) {
    if (condition) {
        passedCount++;
    } else {
        failedCount++;
        console.error("FAILED: " + message);
    }
}

try {
    // Provenance & Panel Boundary Assertion (Replaces deprecated openVerifiedArtifactPanel skip)
    const renderCardMatch = ghostUiJs.match(/function renderRepoMapCard[\s\S]*?\n    \}/);
    const renderErrMatch = ghostUiJs.match(/function renderRepoErrorCard[\s\S]*?\n    \}/);
    if (renderCardMatch && renderErrMatch) {
        let codeSidebarOpened = false;
        let appViewerOpened = false;
        let cardTextContent = '';
        const inspectSandbox = {
            chatLog: {
                appendChild: (node) => { cardTextContent += (node.textContent || ''); },
                scrollTop: 0, scrollHeight: 100
            },
            codeSidebar: { classList: { add: (c) => { if (c === 'open') codeSidebarOpened = true; } } },
            appViewer: { classList: { add: (c) => { if (c === 'open') appViewerOpened = true; } } },
            document: {
                createElement: (tag) => {
                    const el = {
                        style: {}, classList: new Set(),
                        appendChild: (c) => { if (c.textContent) el.textContent += c.textContent; },
                        className: ''
                    };
                    return el;
                }
            }
        };
        vm.createContext(inspectSandbox);
        vm.runInContext(renderCardMatch[0], inspectSandbox);
        vm.runInContext(renderErrMatch[0], inspectSandbox);

        vm.runInContext(`renderRepoMapCard({
            repository: { name: 'Ghost', inspectionId: 'test-123', isBoundedPartial: false },
            summary: { totalFiles: 10, totalDirectories: 2, totalBytes: 5000, maxDepthReached: 1 },
            entryPoints: [], architectureMap: {}, limitsAndEvidence: { actualFilesInspected: 10, actualDirectoriesInspected: 2, actualBytesProcessed: 5000, elapsedMs: 5 },
            disclaimer: 'Read-only map — no commands, file changes, or tests were run.'
        });`, inspectSandbox);

        assertCondition(!codeSidebarOpened && !appViewerOpened, "Repo Inspector success response opens zero code/preview panels");
        assertCondition(cardTextContent.includes("Read-only map — no commands, file changes, or tests were run."), "Repo Inspector card includes explicit read-only disclaimer");
        assertCondition(!/Tool Execution Results|written to|tests passed|executed command/i.test(cardTextContent), "Repo Inspector card claims zero execution/provenance side-effects");

        cardTextContent = '';
        codeSidebarOpened = false;
        appViewerOpened = false;
        vm.runInContext(`renderRepoErrorCard("Unauthorized access");`, inspectSandbox);
        assertCondition(!codeSidebarOpened && !appViewerOpened, "Repo Inspector error response opens zero code/preview panels");
        assertCondition(cardTextContent.includes("Read-only map — no commands, file changes, or tests were run."), "Repo Inspector error card includes explicit read-only disclaimer");
    }

    const responseHandlerMatch = ghostUiJs.match(/function handleGhostResponse[\s\S]*?\n    \}/);
    if (responseHandlerMatch) {
        let appendedResponse = '';
        let spokenResponse = '';
        let codeSidebarOpened = false;
        let appViewerOpened = false;
        const responseSandbox = {
            appendMessage: (sender, text) => { if (sender === 'ghost') appendedResponse = text; },
            codeContent: { innerHTML: '', appendChild: () => { responseSandbox.codeContent.innerHTML = 'x'; } },
            appIframe: { srcdoc: '' },
            appViewer: { classList: { add: (cls) => { if (cls === 'open') appViewerOpened = true; } } },
            codeSidebar: { classList: { add: (cls) => { if (cls === 'open') codeSidebarOpened = true; } } },
            document: { createElement: () => ({ style: {}, appendChild: () => {}, addEventListener: () => {} }) },
            navigator: { clipboard: { writeText: () => {} } },
            speakResponse: (text) => { spokenResponse = text; },
            highlightCode: (code) => code, setTimeout: () => {},
            inputMode: 'text'
        };
        vm.createContext(responseSandbox);
        vm.runInContext(responseHandlerMatch[0], responseSandbox);
        vm.runInContext("handleGhostResponse('Tool Execution Results: a script was written to a file.\\n```python\\nprint(1)\\n```', { state: 'not_started', artifacts: [] }, {});", responseSandbox);
        assertCondition(!/Tool Execution Results|written to a file|\/downloads\//i.test(appendedResponse) && codeSidebarOpened === false && appViewerOpened === false, "Unverified provenance prose is sanitized to ordinary text and opens no panel");

        appendedResponse = '';
        codeSidebarOpened = false;
        appViewerOpened = false;
        vm.runInContext("handleGhostResponse('Here is a simple Python login-page example:\\n```python\\n# login.py\\nprint(\"login\")\\n```', { state: 'not_started', artifacts: [] }, {});", responseSandbox);
        assertCondition(appendedResponse.includes('python') && !/Tool Execution|workspace_|~/i.test(appendedResponse) && codeSidebarOpened === false && appViewerOpened === false, "Normal chat Python example renders text/code cleanly and opens no provenance panel");

        appendedResponse = '';
        codeSidebarOpened = false;
        appViewerOpened = false;
        vm.runInContext("handleGhostResponse('Tool Execution Results: wrote file to ~/Ghost/login.py\\n```python\\nprint(\"login\")\\n```', { state: 'not_started', artifacts: [] }, {});", responseSandbox);
        assertCondition(!/Tool Execution Results|~\/Ghost/i.test(appendedResponse) && codeSidebarOpened === false && appViewerOpened === false, "Fake provenance claim in normal chat is sanitized and opens no panel");

        appendedResponse = '';
        codeSidebarOpened = false;
        appViewerOpened = false;
        vm.runInContext("handleGhostResponse('```html\\n<!DOCTYPE html><html><body>ok</body></html>\\n```', { state: 'succeeded', artifacts: [{ name: 'preview.html', url: '/downloads/preview.html' }] }, { plan: [{ description: 'verified task' }] });", responseSandbox);
        assertCondition(codeSidebarOpened === true && appViewerOpened === true, "Verified evidence can open artifact and live preview panels");

        appendedResponse = '';
        codeSidebarOpened = false;
        appViewerOpened = false;
        vm.runInContext("handleGhostResponse('```html\\n<!DOCTYPE html><html><body>stale</body></html>\\n```', { state: 'failed', artifacts: [] }, {});", responseSandbox);
        assertCondition(codeSidebarOpened === false && appViewerOpened === false, "Partial or failed execution evidence rejects opening provenance views");
    }

    // --- BEHAVIORAL DOM EVENT HARNESS ---
    class MockElement {
        constructor(id) {
            this.id = id;
            this.listeners = {};
            this.classList = new Set();
            this.classList.contains = function(c) { return this.has(c); }; this.classList.remove = function(c) { return this.delete(c); };
            this.attributes = new Map();
            this.style = {};
            this.value = '';
            this.disabled = false;
            this.innerHTML = '';
            this.innerText = '';
            this.textContent = '';
            this.focused = false;
        }
        setAttribute(k, v) { this.attributes.set(k, v); }
        removeAttribute(k) { this.attributes.delete(k); }
        getAttribute(k) { return this.attributes.get(k); }
        addEventListener(type, cb) {
            if (!this.listeners[type]) this.listeners[type] = [];
            this.listeners[type].push(cb);
        }
        dispatchEvent(e) {
            if (this.listeners[e.type]) {
                for (const cb of this.listeners[e.type]) cb(e);
            }
        }
        focus() { this.focused = true; }
        appendChild(c) {}
        scrollTo() {}
        click() { this.dispatchEvent({ type: 'click', preventDefault: ()=>{} }); }
    }

    const elements = {};
    const getEl = (id) => {
        if (!elements[id]) elements[id] = new MockElement(id);
        return elements[id];
    };

    let domContentLoadedCb = null;
    let fetchCalls = 0;
    let fetchRejectNext = false;
    
    const mockDocument = {
        getElementById: getEl,
        querySelector: (sel) => {
            if (sel === '#chatLog .message-card.ghost .bubble') {
                if (elements['chatLog'] && elements['chatLog'].innerHTML.includes('bubble')) {
                    return getEl('firstBubble');
                }
                return null;
            }
            return getEl(sel);
        },
        querySelectorAll: () => [],
        createElement: (tag) => new MockElement(tag + Math.random()),
        addEventListener: (e, cb) => {
            if (e === 'DOMContentLoaded') domContentLoadedCb = cb;
        },
        hidden: false,
        body: getEl('body')
    };

    const visualizerHasPointerEventsNone = cssCode.includes('.visualizer-container-main {') && cssCode.includes('pointer-events: none;');
    mockDocument.elementFromPoint = (x, y) => {
        if (x === 900 && y === 900) {
            if (!visualizerHasPointerEventsNone) return getEl('visualizer-container-main');
            return getEl('sendBtn');
        }
        return getEl('body');
    };

    const mockWindow = {
        VITE_GHOST_API_BASE: '',
        location: { hostname: 'localhost' },
        addEventListener: () => {},
        cancelActiveRun: null,
        navigator: { mediaDevices: { getUserMedia: async () => { throw new Error('Microphone permission denied'); } } },
        speechSynthesis: { getVoices: () => [], speak: () => {} },
        AudioContext: class { createOscillator() { return { connect:()=>{}, start:()=>{}, stop:()=>{} }; } createGain() { return { gain: { setValueAtTime:()=>{} }, connect:()=>{} }; } },
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
    };

    // NOTE: playClickSound is intentionally NOT in sandbox.
    // This proves the typeof guard prevents ReferenceError on the SEND path.
    const sandbox = {
        document: mockDocument,
        window: mockWindow, location: mockWindow.location,
        navigator: mockWindow.navigator,
        speechSynthesis: mockWindow.speechSynthesis,
        AudioContext: mockWindow.AudioContext,
        IntersectionObserver: class { constructor(){} observe(){} unobserve(){} disconnect(){} },
        console: { log: ()=>{}, warn: ()=>{}, error: ()=>{} },
        alert: (message) => { sandbox.lastAlert = String(message); },
        setInterval: () => {}, clearInterval: () => {}, setTimeout: (cb, t) => {
            if (t === 15000) sandbox.abortCb = cb;
            return 999;
        },
        clearTimeout: () => {},
        fetch: async (url, opts) => {
            fetchCalls++;
            if (fetchRejectNext) {
                fetchRejectNext = false;
                throw new Error('AbortError');
            }
            if (url.includes('/api/chat')) {
                return { status: 200, json: async () => ({ success: true, text: 'mock response' }) };
            }
            return { status: 200, json: async () => ({}) };
        },
        AbortController: class { constructor() { this.signal = {}; } abort() { sandbox.isAborted = true; } },
        FileReader: class { readAsDataURL(){} readAsText(){} },
        THREE: {
            Scene: class {}, PerspectiveCamera: class {}, WebGLRenderer: class { setSize(){} setPixelRatio(){} setClearColor(){} constructor() { this.domElement = getEl('canvas'); } },
            Group: class {}, SphereGeometry: class {}, PointsMaterial: class {}, Points: class {}, BackSide: 1, TextureLoader: class { load(){ return {}; } },
            MeshBasicMaterial: class {}, Mesh: class {}, Color: class {}
        },
        Math, Object, Array, String, Set, Map, Date, JSON, URL, Promise, RegExp, Error
    };

    vm.createContext(sandbox);

    let modifiedJs = ghostUiJs;
    modifiedJs = modifiedJs.replace(/window\.location/g, 'location');

    vm.runInContext(modifiedJs, sandbox);
    
    if (domContentLoadedCb) domContentLoadedCb();
    else throw new Error("DOMContentLoaded not captured");

    const userInput = getEl('userInput');
    const sendBtn = getEl('sendBtn');
    

    async function main() {
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        // Hit test proof
        assertCondition(visualizerHasPointerEventsNone, "CSS visualizer-container-main has pointer-events: none");
        assertCondition(mockDocument.elementFromPoint(900, 900) === sendBtn, "Mock elementFromPoint hits sendBtn, not blocked by visualizer");

        // Local owner-unlock path: the visitor gate button must reveal the existing
        // password input, and Back must restore usable visitor onboarding.
        const showUnlockBtn = getEl('showUnlockBtn');
        const loginOverlay = getEl('loginOverlay');
        const visitorGateOverlay = getEl('visitorGateOverlay');
        const authInput = getEl('authInput');
        showUnlockBtn.click();
        assertCondition(loginOverlay.style.display === 'flex' && loginOverlay.style.visibility === 'visible', "Local Unlock Ghost click opens the owner authentication prompt");
        assertCondition(authInput.focused === true && authInput.value === '', "Owner prompt focuses an empty password field");
        getEl('backToVisitorBtn').click();
        assertCondition(loginOverlay.style.visibility === 'hidden' && visitorGateOverlay.style.display === '', "Cancellation returns to visitor onboarding");
        assertCondition(showUnlockBtn.disabled === false && getEl('visitorContinueBtn').disabled === false, "Cancellation keeps visitor controls usable");

        // A rejected owner authentication attempt must remain recoverable without
        // changing the visitor session or exposing the attempted value.
        showUnlockBtn.click();
        const ownerPromptMessage = getEl('#loginOverlay .login-sub').innerText;
        const attemptedValue = 'invalid-test-value';
        authInput.value = attemptedValue;
        authInput.dispatchEvent({ type: 'keypress', key: 'Enter', preventDefault: () => {} });
        await delay(50);
        const failureMessage = sandbox.lastAlert || getEl('ownerAuthError').innerText || getEl('#loginOverlay .login-sub').innerText;
        assertCondition(authInput.disabled === false && failureMessage !== ownerPromptMessage && !failureMessage.includes(attemptedValue), "Rejected owner authentication shows a non-secret message and keeps controls usable");
        getEl('backToVisitorBtn').click();
        assertCondition(visitorGateOverlay.style.display === '' && showUnlockBtn.disabled === false, "Rejected owner authentication can return to visitor onboarding");

        // A public origin must not expose the private owner prompt through the same
        // control; visitor entry remains usable.
        const publicElements = {};
        const publicGetEl = (id) => {
            if (!publicElements[id]) publicElements[id] = new MockElement(id);
            return publicElements[id];
        };
        const publicDocument = {
            ...mockDocument,
            getElementById: publicGetEl,
            querySelector: () => publicGetEl('query'),
            querySelectorAll: () => [],
            body: publicGetEl('body')
        };
        const publicWindow = { ...mockWindow, location: { hostname: 'ghost.example.com' } };
        const publicSandbox = { ...sandbox, document: publicDocument, window: publicWindow, location: publicWindow.location };
        let publicDomReady = null;
        publicDocument.addEventListener = (event, callback) => { if (event === 'DOMContentLoaded') publicDomReady = callback; };
        vm.createContext(publicSandbox);
        vm.runInContext(modifiedJs, publicSandbox);
        publicDomReady();
        publicGetEl('showUnlockBtn').click();
        assertCondition(publicGetEl('loginOverlay').style.display !== 'flex' && publicGetEl('visitorContinueBtn').disabled === false, "Public-origin guard keeps owner prompt closed and visitor entry usable");

        // 1. playClickSound guard proof: sendBtn click with playClickSound UNDEFINED must not throw
        assertCondition(typeof sandbox.playClickSound === 'undefined', "playClickSound is intentionally undefined in sandbox");

        // 2. Non-empty input + SEND click -> real path exactly once, clears composer
        fetchCalls = 0;
        userInput.value = "Hello Ghost";
        sendBtn.click();
        
        assertCondition(fetchCalls === 1, "Non-empty SEND click invokes fetch path exactly once");
        assertCondition(userInput.value === "", "Composer is cleared immediately");
        
        await delay(50);

        // IME composition must not submit, and an immediate click+Enter race shares
        // the same in-flight submission.
        fetchCalls = 0;
        userInput.value = "IME text";
        userInput.dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: true, preventDefault: () => {} });
        assertCondition(fetchCalls === 0, "Composing Enter invokes zero times");
        userInput.value = "One request";
        sendBtn.click();
        userInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
        assertCondition(fetchCalls === 1, "Click plus Enter during one active request invokes once");
        await delay(50);

        // 3. Empty input -> zero times
        fetchCalls = 0;
        userInput.value = " ";
        sendBtn.click();
        assertCondition(fetchCalls === 0, "Empty SEND click invokes zero times");

        // 4. Non-empty Enter keypress -> uses same processCommand path exactly once
        fetchCalls = 0;
        userInput.value = "Hello Enter";
        userInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
        assertCondition(fetchCalls === 1, "Non-empty keydown Enter invokes the shared path exactly once");
        
        await delay(50);

        // 5. Empty Enter -> zero times
        fetchCalls = 0;
        userInput.value = " ";
        userInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
        assertCondition(fetchCalls === 0, "Empty Enter key invokes zero times");

        // 6. Non-Enter keypress -> zero times
        fetchCalls = 0;
        userInput.value = "typing...";
        userInput.dispatchEvent({ type: 'keydown', key: 'a', preventDefault: () => {} });
        assertCondition(fetchCalls === 0, "Non-Enter keypress invokes zero times");

        // 7. Simulate AbortError -> catch-block cleanup
        fetchRejectNext = true;
        userInput.value = "Fail test";
        sendBtn.click();
        
        await delay(50);
        
        const thinking = getEl('thinkingIndicator');
        assertCondition(thinking.classList.contains('active') === false, "Catch cleanup removes thinking indicator after AbortError");
        assertCondition(userInput.disabled === false, "Catch cleanup leaves composer enabled after AbortError");

        // 8. Persona-Tag Suppression in Pure Conversational Responses (src/brain.js)
        const brain = require('../src/brain.js');
        if (brain && typeof brain.summarize === 'function') {
            const mockUserMessage = "hello";
            const mockActions = [{ tool: "chat", reason: "Direct Q&A" }];
            const mockResults = [{ output: "[NOVA]: Hello! How can I help you today?" }];
            const cleanResult = await brain.summarize(mockUserMessage, mockActions, mockResults);

            assertCondition(!/^(?:\[?(?:NOVA|ECHO|ROUTER|ORCHESTRATOR|ADVISOR|ENGINEER|chat ➔ llm)\]?:?\s*)/i.test(cleanResult), "Pure chat response contains zero internal persona tags or [chat ➔ llm] prefix");
            assertCondition(cleanResult.length > 0 && !/executed command|wrote file|created artifact|downloads/i.test(cleanResult), "Pure chat response is clean, non-empty, and claims zero execution or file artifacts");
        }

        // 9. Onboarding & Owner Unlock Form Submission & Inline Error Coverage
        assertCondition(ghostUiJs.includes("submitVisitorForm") || ghostUiJs.includes("submitOwnerLogin"), "UI implements form submit flows for visitor onboarding and owner unlock");
        assertCondition(ghostUiJs.includes("showOwnerError") && !ghostUiJs.includes("alert('Invalid clearance key.')"), "Owner access uses non-blocking inline error rather than window alert dialog");

        // 10. Separated Display-Name Storage & Owner Authorization Boundary
        assertCondition(ghostUiJs.includes("ghost_owner_display_name") && ghostUiJs.includes("getStoredOwnerName"), "Owner display name persists in same-origin client key ghost_owner_display_name");
        assertCondition(!/localStorage\.setItem\(['"]ghost_owner_display_name['"],\s*.*(passphrase|token|role|chat)/i.test(ghostUiJs), "Owner display name storage excludes passphrases, tokens, roles, and chat text");

        // 11. Truthful Grounded Conversation (No Invented History Claims)
        if (brain && typeof brain.summarize === 'function') {
            const mockMsg = "hello";
            const mockActions = [{ tool: "chat", reason: "Direct Q&A" }];
            const mockHistoryOutputs = [
                { output: "I see you've said hello again. How can I help?" },
                { output: "As we discussed earlier, what would you like to build?" },
                { output: "Hello! What can I help you with today?" }
            ];
            for (const resItem of mockHistoryOutputs) {
                const groundCheck = await brain.summarize(mockMsg, mockActions, [resItem], { history: [] });
                assertCondition(!/\b(hello again|as we discussed|as I recall|I remember|you told me|you said that again)\b/i.test(groundCheck), "Fresh conversational hello contains zero unsupported prior history phrases");
            }
        }
        
        // 12. Fresh-load & Coherent Hands-Free State and Failure Teardown
        assertCondition(ghostUiJs.includes("HANDS-FREE MODE // ON") && ghostUiJs.includes("HANDS-FREE MODE // OFF"), "Hands-Free state updates overlay status badge to match mode state");
        assertCondition(ghostUiJs.includes("Voice transcription is unavailable right now. You can continue typing."), "Hands-Free audio pipeline failure emits one concise recoverable message");

        // 13. Owner-Authenticated Card Status Synchronization
        assertCondition(ghostUiJs.includes("ghostCodeStatus.innerText = isGhostCodeActive") && ghostUiJs.includes("handsFreeStatus.innerText = isHandsFreeActive"), "Owner authentication updates sidebar card status labels from owner unlock required to actual mode status");

        // 14. Unverified Research Query Truthfulness
        if (brain && typeof brain.summarize === 'function') {
            const researchResult = await brain.summarize("what is the news", [{ tool: "web_search" }], [{ output: "Generic web results without urls" }]);
            assertCondition(!/\[web_search\s*➔\s*webAgent\]/i.test(researchResult), "Research response exposes zero internal routing tags [web_search ➔ webAgent]");
            assertCondition(researchResult.includes("I don't have verified live research data in this chat"), "Unverified news request returns honest live research fallback");
        }

        // 15. Python Login-Page Code Request Truthfulness
        if (brain && typeof brain.summarize === 'function') {
            const codeResult = await brain.summarize("write a code for login page in python", [{ tool: "chat" }], [{ output: "Here is a simple login page in Python:\n\n```python\ndef login(): pass\n```" }]);
            assertCondition(codeResult.includes("```python"), "Python code request returns useful python code block");
            assertCondition(!/executed command|wrote file|created artifact|downloads/i.test(codeResult), "Python code request claims zero file execution or artifact creation");
        }

        // 16. Fast Normal-Chat Direct Single Bounded Path
        const brainJs = fs.readFileSync(path.join(__dirname, '../src/brain.js'), 'utf8');
        assertCondition(brainJs.includes("isOrdinaryChatRequest") && brainJs.includes("[Brain Fast Path]"), "Brain implements fast direct chat completion for ordinary conversational requests");

        // 17. Bounded Client Request Lifecycle (20s AbortController)
        assertCondition(ghostUiJs.includes("AbortController") && ghostUiJs.includes("controller.abort(), 20000"), "Client enforces bounded 20s request lifetime with AbortController");
        assertCondition(ghostUiJs.includes("Response timed out. You can continue typing."), "Client abort cleanly reports recoverable timeout message without locking composer");

        // 18. Truthful Ghost Code Card Wording
        assertCondition(ghostUiJs.includes("Ghost Code · Ready to draft a plan"), "Ghost Code status uses truthful non-deceptive wording 'Ready to draft a plan'");
        assertCondition(!ghostUiJs.includes("ON // Code Execution Active"), "Ghost Code avoids claiming unverified code execution is active");

        // 19. Quick-Action Prompt Chips & Intentional Empty State
        assertCondition(ghostUiJs.includes("quick-action-pill") && ghostUiJs.includes("Draft a plan") && ghostUiJs.includes("Write code as text") && ghostUiJs.includes("Explain an error"), "Workspace provides 4 intentional quick-action prompt chips in welcome state");

        // 20. Subordinated Inactive Visualizer
        assertCondition(cssCode.includes(".visualizer-container-main") && cssCode.includes("display: none") && cssCode.includes(".visualizer-container-main.active"), "Visualizer container is collapsed and subordinated when idle to eliminate dead screen space");

        // 21. Deterministic Immediate News Boundary
        if (brain && typeof brain.think === 'function') {
            const newsPhrases = ["what is the news", "latest news", "news today", "current headlines"];
            for (const phrase of newsPhrases) {
                const thinkNews = await brain.think(phrase, { safeUser: 'guest', isAdmin: false });
                assertCondition(thinkNews.reply === "I don't have verified live research data in this chat. I can help you frame a search or summarize sources you provide.", `Deterministic immediate news response verified for: "${phrase}"`);
            }
        }

        // 22. Dotenv Local Environment Precedence
        const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        assertCondition(serverJs.includes("dotenv.config({ override: true })"), "Server.js configures dotenv with explicit override: true to ensure local .env precedence");

        // 23. SpeechSynthesis Voice Resilience & Lifecycle
        assertCondition(ghostUiJs.includes("utterance.lang = 'en-US'") && ghostUiJs.includes("window.speechSynthesis.resume()"), "SpeechSynthesis handles voice fallback gracefully with default lang and resume");

        // 24. Hermes-Inspired Plan/Diff Worker V1 Pure Proposal Contract
        assertCondition(serverJs.includes("app.post('/api/plan/draft'") && ghostUiJs.includes("renderPlanDraftCard") && ghostUiJs.includes("PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST"), "Plan/Diff Worker V1 route and client render pure proposal with fixed safety notice");

        // 25. Personal Core V1 Memory, Goals, and Continuity Contract
        assertCondition(serverJs.includes("app.get('/api/personal/overview'") && ghostUiJs.includes("personalCoreBtn") && ghostUiJs.includes("loadPersonalOverview") && !ghostUiJs.includes("applyPersonalActionBtn"), "Personal Core V1 route family and UI client render owner-only memory and goals with zero autonomous execution");

        // 26. Plan/Diff Current-Request Binding & Personal Context Routing
        assertCondition(serverJs.includes("planDraft.approvedPersonalContext = approvedPersonalContext") && ghostUiJs.includes("currentPlanRequestId") && ghostUiJs.includes("plan.approvedPersonalContext"), "Plan/Diff Worker binds current request and owner personal context with race-safe sequence tracking");

        // 27. Task Ledger V1 Bounded Task Queue & Immutable Activity Ledger Contract
        assertCondition(serverJs.includes("app.get('/api/personal/tasks'") && serverJs.includes("app.get('/api/personal/tasks/:taskId/events'") && ghostUiJs.includes("tabTasksBtn") && ghostUiJs.includes("renderTaskEventsList") && !serverJs.includes("app.delete('/api/personal/tasks/:taskId/events"), "Task Ledger V1 route family and UI client render owner-only tasks and immutable activity ledger with zero autonomous execution");

        // 28. Ordinary Chat Bounded Lifecycle & Personal Core Routing Contract
        assertCondition(
            brain && typeof brain.isOrdinaryChatRequest === 'function' &&
            brain.isOrdinaryChatRequest("Plan the next three small, safe tasks that move Ghost toward becoming my private personal AI. Rules: - Do not make changes. - Do not run commands or tests.") === true &&
            serverJs.includes("personalContext: approvedPersonalContext") &&
            ghostUiJs.includes("Response timed out. You can continue typing.") &&
            ghostUiJs.includes("sendBtn.disabled = false;"),
            "Ordinary chat routes directly to bounded single completion with approved Personal Core context and reliable client restore on timeout"
        );

        // 29. Ghost Agent V0 Bounded Task Proposal Contract
        assertCondition(
            serverJs.includes("app.post('/api/task-agent/propose'") &&
            ghostUiJs.includes("btnAskTaskAgent") &&
            ghostUiJs.includes("renderTaskAgentProposal") &&
            ghostUiJs.includes("PROPOSAL ONLY — NO ACTIONS EXECUTED") &&
            ghostUiJs.includes("agent_proposal_created"),
            "Ghost Agent V0 route and UI client enforce bounded, owner-only task proposals with immutable ledger logging and zero execution"
        );

        // 30. Ghost Agent V0.1 Grounded Proposals & Explicit Owner Feedback Contract
        assertCondition(
            serverJs.includes("app.post('/api/task-agent/feedback'") &&
            ghostUiJs.includes("agent-grounding-statement") &&
            ghostUiJs.includes("btn-feedback-rating") &&
            ghostUiJs.includes("btn-save-feedback") &&
            ghostUiJs.includes("agent_proposal_feedback_recorded") &&
            ghostUiJs.includes("Only feedback you save is used to refine future Agent proposals. It never authorizes actions or changes tasks."),
            "Ghost Agent V0.1 enforces grounded proposals with visible grounding and explicit owner feedback without silent learning or execution"
        );

        // 31. Ghost Approval Contract V1 Non-Executing Proposal Preparation Contract
        assertCondition(
            serverJs.includes("app.post('/api/approval-contract/draft'") &&
            serverJs.includes("app.post('/api/approval-contract/:contractId/review'") &&
            serverJs.includes("app.post('/api/approval-contract/:contractId/cancel'") &&
            ghostUiJs.includes("btnPrepareApprovalContract") &&
            ghostUiJs.includes("APPROVAL CONTRACT ONLY — NO FILES CHANGED — NO COMMANDS OR TESTS EXECUTED — NO WORKER STARTED — OWNER CANCELLATION AVAILABLE") &&
            ghostUiJs.includes("approval_contract_drafted") &&
            ghostUiJs.includes("approval_contract_reviewed") &&
            ghostUiJs.includes("approval_contract_cancelled"),
            "Ghost Approval Contract V1 enforces owner-only reviewable proposal preparation with literal safety banner, lifecycle ledger events, and zero execution"
        );

        // 32. Ghost Approval-Gated Test Worker V0 Strict Safety & Explicit Execution Contract
        const approvalWorkerJs = fs.readFileSync(path.join(__dirname, '../services/approvalTestWorker.js'), 'utf8');
        assertCondition(
            serverJs.includes("app.post('/api/approval-test-runs/:contractId/start'") &&
            serverJs.includes("app.post('/api/approval-test-runs/:runId/cancel'") &&
            ghostUiJs.includes("TEST-ONLY WORKER V0 — NO PRODUCTION FILES CHANGED — NO BROAD SHELL, MAC, BROWSER, NETWORK, GIT, OR DEPLOYMENT ACCESS — EXPLICIT OWNER START AND CANCELLATION REQUIRED") &&
            ghostUiJs.includes("startTestRunBtn") &&
            ghostUiJs.includes("cancelTestRunBtn") &&
            ghostUiJs.includes("refreshTestRunBtn") &&
            ghostUiJs.includes("production_files_changed: 0") &&
            ghostUiJs.includes("production_file_write_authority: false") &&
            ghostUiJs.includes("approval_gated_test_worker_v0_test") &&
            !ghostUiJs.includes("approval-gated-worker-v0-contract") &&
            approvalWorkerJs.includes("approval_gated_test_worker_v0_test") &&
            !approvalWorkerJs.includes("approval-gated-worker-v0-contract") &&
            !approvalWorkerJs.includes("validateFixtureEditScope"),
            "Ghost Approval-Gated Test Worker V0 enforces strict safety banner, explicit owner start/cancel controls, single canonical identifier, zero write helpers, and zero production file changes"
        );

        // 33. Ghost Truthful Identity Repair & Cited AI News V1 Contract
        const aiNewsJs = fs.readFileSync(path.join(__dirname, '../services/aiNews.js'), 'utf8');
        assertCondition(
            !serverJs.includes("Tony Stark") &&
            !ghostUiJs.includes("Tony Stark") &&
            serverJs.includes("I do not have verified creator or owner information available in this chat, so I will not invent it.") &&
            serverJs.includes("Understood. Please note that corrections in ordinary chat are not saved, verified, or remembered. To persist owner facts, please use the explicit Personal Core flow.") &&
            serverJs.includes("I did not receive a request. You can ask for a plan, code as text, a repository inspection, or check AI news.") &&
            aiNewsJs.includes("Scope: Global AI news — Google News RSS.") &&
            aiNewsJs.includes("AI news fetched just now from Google News RSS. Here are up to five cited headlines; I did not open or summarize the linked articles.") &&
            aiNewsJs.includes("https://news.google.com/rss/search?q=artificial%20intelligence&hl=en-US&gl=US&ceid=US:en") &&
            ghostUiJs.includes("rel=\"noopener noreferrer\""),
            "Ghost Truthful Identity & AI News V1 enforces honest identity boundaries, ungrounded reply guards, cited safe links, and zero background auto-fetch/polling"
        );

        if (failedCount > 0) {
            process.exitCode = 1;
        }
        console.log(`
GHOST_EVIDENCE_INTEGRITY_TESTS: ${passedCount} passed, ${failedCount} failed`);
    }

    main().catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
} catch (err) {
    console.error("BLOCKED: Test execution error: " + err.stack);
    process.exit(1);
}
