
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ghostUiJs = fs.readFileSync(path.join(__dirname, 'public/ghost-ui.js'), 'utf8');

let passedCount = 0;
let failedCount = 0;

function assertCondition(condition, message) {
    if (condition) passedCount++;
    else {
        failedCount++;
        console.error("FAILED: " + message);
    }
}

async function runTests() {
    const mockDom = {
        classList: new Set(),
        attributes: new Map(),
        add(cls) { this.classList.add(cls); },
        remove(cls) { this.classList.delete(cls); },
        contains(cls) { return this.classList.has(cls); },
        setAttribute(k, v) { this.attributes.set(k, v); },
        removeAttribute(k) { this.attributes.delete(k); },
        getAttribute(k) { return this.attributes.get(k); },
        appendChild() {},
        innerText: '',
        innerHTML: '',
        value: '',
        disabled: false,
        focus() {}
    };
    
    const createMockElement = () => ({ ...mockDom, classList: new Set(), attributes: new Map() });
    
    const thinkingIndicator = createMockElement();
    const userInput = createMockElement();
    const sendBtn = createMockElement();
    const chatLog = createMockElement();
    let messagesAppended = [];
    
    const sandbox = {
        window: { location: { hostname: 'localhost' } },
        document: {
            getElementById: (id) => {
                if (id === 'thinking-indicator') return thinkingIndicator;
                if (id === 'userInput') return userInput;
                if (id === 'sendBtn') return sendBtn;
                if (id === 'chatLog') return chatLog;
                return createMockElement();
            },
            createElement: () => createMockElement(),
        },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout: (cb, ms) => {
            if (ms === 15000) {
                cb();
                return 999;
            }
            return 1;
        },
        clearTimeout: () => {},
        AbortController: class {
            constructor() { this.signal = { aborted: false }; }
            abort() { this.signal.aborted = true; }
        },
        fetch: async (url, opts) => {
            if (opts && opts.signal && opts.signal.aborted) {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                throw err;
            }
            await new Promise(r => setImmediate(r));
            if (opts && opts.signal && opts.signal.aborted) {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                throw err;
            }
            return {
                status: 200,
                json: async () => ({ success: true, text: "Mock response" })
            };
        },
        Buffer: Buffer,
        masterUser: "master",
        uploadedImageBase64: "",
        uploadedFileText: "",
        uploadedFileBase64: "",
        uploadedFileName: "",
        isGhostCodeActive: false,
        isHandsFreeActive: false,
        isAdminMode: true,
        apiUrl: (path) => path,
        parseMarkdown: (t) => t,
        handleGhostResponse: () => {},
        renderTaskTrace: () => {},
        openVerifiedArtifactPanel: () => {},
        renderAntigravityPlanCard: () => {},
        renderHitlActionCard: () => {},
        appendMessage: (sender, text) => { messagesAppended.push({sender, text}); },
        messagesAppended,
        thinkingIndicator,
        userInput,
        sendBtn
    };

    vm.createContext(sandbox);

    const safeScript = `
        ${ghostUiJs}
        globalThis.testProcessCommand = processCommand;
        globalThis.testSetChatBusy = setChatBusy;
    `;
    
    sandbox.document.addEventListener = () => {};
    sandbox.window.addEventListener = () => {};
    
    const stubs = ['sendBtn', 'userInput', 'attachmentInput', 'handsFreeBtn', 'codeSidebarClose', 'micToggleBtn', 'createProjectBtn', 'saveMemoryBtn', 'ghostCodeBtn', 'visitorOverlay'];
    stubs.forEach(id => {
        const el = createMockElement();
        el.addEventListener = () => {};
        sandbox[id] = el;
    });
    
    // Some elements are accessed via getElementById
    const oldGet = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => {
        if (sandbox[id]) return sandbox[id];
        return oldGet(id);
    };

    vm.runInContext(safeScript, sandbox);

    await vm.runInContext(`testProcessCommand("test timeout");`, sandbox);
    
    const lastMessage = messagesAppended[messagesAppended.length - 1];
    assertCondition(lastMessage && lastMessage.text.includes("timed out"), "Timeout message not rendered");
    
    assertCondition(!thinkingIndicator.classList.has('active'), "Preparing indicator remained active after timeout");
    assertCondition(thinkingIndicator.getAttribute('aria-busy') !== 'true', "Indicator aria-busy not cleared");
    assertCondition(userInput.disabled === false, "User input remained disabled");
    assertCondition(sendBtn.disabled === false, "Send button remained disabled");

    console.log(`GHOST_TIMEOUT_TESTS: ${passedCount} passed, ${failedCount} failed`);
}

runTests();
