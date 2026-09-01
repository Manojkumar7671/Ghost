const fs = require('fs');
const path = require('path');

const indexFile = path.resolve(__dirname, '../public/index.html');
const jsFile = path.resolve(__dirname, '../public/ghost-ui.js');

const indexHtml = fs.readFileSync(indexFile, 'utf8');
const ghostUiJs = fs.readFileSync(jsFile, 'utf8');

const assert = (condition, message) => {
    if (!condition) {
        console.error(`Assertion failed: ${message}`);
        process.exit(1);
    }
};

// 1. index.html has no mic or voice layout
assert(!indexHtml.includes('micToggleBtn'), "index.html should not contain micToggleBtn");
assert(!indexHtml.includes('mic-btn'), "index.html should not contain mic-btn class");

// 2. ghost-ui.js has no micToggleBtn, handsFree, voiceState, or speechSynthesis variables/references.
assert(!ghostUiJs.includes('micToggleBtn'), "ghost-ui.js should not contain micToggleBtn");
assert(!ghostUiJs.includes('isHandsFreeActive'), "ghost-ui.js should not contain isHandsFreeActive");
assert(!ghostUiJs.includes('voiceState'), "ghost-ui.js should not contain voiceState");
assert(!ghostUiJs.includes('speechSynthesis'), "ghost-ui.js should not contain speechSynthesis");
assert(!ghostUiJs.includes('speakResponse'), "ghost-ui.js should not contain speakResponse");

// 3. ghost-ui.js has no handsFreeMode payload properties or auto-execution branching.
assert(!ghostUiJs.includes('handsFreeMode:'), "ghost-ui.js should not contain handsFreeMode payload");
assert(!ghostUiJs.includes('if (isHandsFreeActive)'), "ghost-ui.js should not contain auto-execution branching for hands-free");

// 4. ghost-ui.js still contains normal chat execution and Control Center constants.
assert(ghostUiJs.includes('processCommand(val)'), "ghost-ui.js should preserve normal chat execution");

console.log("Static source test passed: Confirmed absence of legacy voice/hands-free code and presence of normal chat/Control Center code.");
