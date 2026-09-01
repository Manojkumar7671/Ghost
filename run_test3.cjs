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
        focus() {},
        addEventListener(event, cb) {
            if (!this._listeners) this._listeners = {};
            this._listeners[event] = cb;
        },
        click() {
            if (this._listeners && this._listeners['click']) {
                this._listeners['click']();
            }
        },
        style: {}
    };
    
    const createMockElement = () => ({ ...mockDom, classList: new Set(), attributes: new Map(), style: {} });
    
    const elements = {
        'thinking-indicator': createMockElement(),
        'userInput': createMockElement(),
        'sendBtn': createMockElement(),
        'chatLog': createMockElement(),
        'appIframe': createMockElement(),
        'codeSidebar': createMockElement(),
        'codeContent': createMockElement(),
        'loginOverlay': createMockElement(),
        'appLayout': createMockElement(),
        'micToggleBtn': createMockElement(),
        'handsFreeBtn': createMockElement(),
        'handsFreeOverlay': createMockElement(),
        'attachmentInput': createMockElement(),
        'codeSidebarClose': createMockElement(),
        'createProjectBtn': createMockElement(),
        'saveMemoryBtn': createMockElement(),
        'ghostCodeBtn': createMockElement(),
        'visitorOverlay': createMockElement()
    };
    
    const sandbox = {
        window: { 
            location: { hostname: 'localhost' },
            addEventListener: (e, cb) => {
                if (e === 'DOMContentLoaded') setTimeout(cb, 1);
            },
            speechSynthesis: { speak: () => {}, cancel: () => {}, pending: false, speaking: false }
        },
        document: {
            getElementById: (id) => elements[id] || createMockElement(),
            createElement: () => createMockElement(),
            querySelectorAll: () => [],
            addEventListener: (e, cb) => {
                if (e === 'DOMContentLoaded') setTimeout(cb, 1);
            }
        },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        setTimeout: (cb, ms) => {
            if (ms === 15000) {
                sandbox._timeoutCb = cb;
                return 15000;
            }
            if (ms === 1) return global.setTimeout(cb, 1);
            return 1;
        },
        clearTimeout: (id) => {
            if (id === 15000) sandbox._timeoutCb = null;
        },
        AbortController: class {
            constructor() { this.signal = { aborted: false }; sandbox._abortControllers.push(this); }
            abort() { this.signal.aborted = true; }
        },
        _abortControllers: [],
        fetch: async (url, opts) => {
            return new Promise((resolve, reject) => {
                sandbox._pendingFetch = { resolve, reject, opts };
            });
        },
        Buffer: Buffer,
        parseMarkdown: (t) => t,
        apiUrl: (p) => p,
        masterUser: "master",
        uploadedImageBase64: "",
        uploadedFileText: "",
        uploadedFileBase64: "",
        uploadedFileName: "",
        isGhostCodeActive: false,
        isHandsFreeActive: false,
        isAdminMode: true,
        elements: elements
    };

    vm.createContext(sandbox);
    
    vm.runInContext(ghostUiJs, sandbox);
    
    await new Promise(r => global.setTimeout(r, 50));
    
    sandbox.elements['userInput'].value = "test command";
    sandbox.elements['sendBtn'].click();
    
    assertCondition(sandbox.elements['thinking-indicator'].classList.has('active'), "Should be active immediately");
    
    if (sandbox._timeoutCb) {
        sandbox._timeoutCb();
    }
    
    if (sandbox._pendingFetch && sandbox._pendingFetch.opts.signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        sandbox._pendingFetch.reject(err);
    }
    
    await new Promise(r => global.setTimeout(r, 50));
    
    assertCondition(!sandbox.elements['thinking-indicator'].classList.has('active'), "Should not be active after timeout");
    console.log(`TESTS: ${passedCount} passed, ${failedCount} failed`);
}

runTests();
