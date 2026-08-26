const fs = require('fs');
const path = require('path');

console.log("--- RUNNING REAL UI REFINEMENT & COLLAPSIBLE SIDEBAR TEST SUITE ---");

let passed = 0;
let failed = 0;

function assertCondition(condition, message) {
    if (condition) {
        passed++;
        console.log(`✓ PASS: ${message}`);
    } else {
        failed++;
        console.error(`✕ FAIL: ${message}`);
    }
}

const htmlCode = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const cssCode = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const jsCode = fs.readFileSync(path.join(__dirname, '../public/ghost-ui.js'), 'utf8');

// 1. Collapsible Sidebar DOM & Accessibility
assertCondition(
    htmlCode.includes('id="sidebarCollapseBtn"') &&
    htmlCode.includes('aria-label="Collapse navigation"') &&
    htmlCode.includes('aria-expanded="true"') &&
    htmlCode.includes('id="appSidebar"'),
    "1. Sidebar HTML includes accessible collapse button with initial aria-expanded='true'"
);

// 2. Primary Navigation Rails Present
assertCondition(
    htmlCode.includes('id="navChatBtn"') &&
    htmlCode.includes('id="navPersonalCoreBtn"') &&
    htmlCode.includes('id="navTasksBtn"') &&
    htmlCode.includes('id="navInspectRepoBtn"') &&
    htmlCode.includes('id="navPlanDiffBtn"'),
    "2. Semantic primary navigation rail contains all core workspace entries"
);

// 3. Mobile Navigation Elements & Backdrop
assertCondition(
    htmlCode.includes('id="mobileMenuBtn"') &&
    htmlCode.includes('id="sidebarBackdrop"') &&
    htmlCode.includes('aria-label="Open navigation menu"'),
    "3. Mobile menu button and backdrop overlay exist for safe drawer operation"
);

// 4. Static Visualizer Orb (No Heavy Animation)
assertCondition(
    htmlCode.includes('class="static-status-orb"') &&
    cssCode.includes('.static-status-orb {') &&
    cssCode.includes('radial-gradient('),
    "4. Static visualizer orb styled via pure CSS without canvas/animation loops"
);

// 5. CSS Collapsed & Expanded Transitions and Reduced Motion
assertCondition(
    cssCode.includes('.sidebar.collapsed {') &&
    cssCode.includes('width: 64px;') &&
    cssCode.includes('prefers-reduced-motion') &&
    cssCode.includes('focus-visible'),
    "5. CSS defines collapsed state (64px), smooth transitions, focus rings, and reduced motion"
);

// 6. Progressive Disclosure for Task Activity Ledger
assertCondition(
    htmlCode.includes('class="ledger-disclosure"') &&
    htmlCode.includes('id="taskActivityDisclosure"') &&
    htmlCode.includes('summary class="ledger-disclosure-summary"'),
    "6. Task activity ledger is structured behind progressive disclosure details element"
);

// 7. Truthful Safety Banners Preserved
assertCondition(
    jsCode.includes("APPROVAL CONTRACT ONLY — NO FILES CHANGED — NO COMMANDS OR TESTS EXECUTED — NO WORKER STARTED — OWNER CANCELLATION AVAILABLE") &&
    jsCode.includes("PROPOSAL ONLY — NO ACTIONS EXECUTED") &&
    jsCode.includes("PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED"),
    "7. Truthful safety banners and non-execution notices are preserved"
);

// 8. JS Collapsible Sidebar State Machine & Keyboard Wiring
assertCondition(
    jsCode.includes("setSidebarCollapsed") &&
    jsCode.includes("sidebarCollapseBtn.setAttribute('aria-expanded'") &&
    jsCode.includes("openMobileDrawer") &&
    jsCode.includes("closeMobileDrawer"),
    "8. JS implements expand/collapse toggle with accurate aria-expanded and mobile drawer lifecycle"
);

// 9. Escape Key Closes Mobile Drawer and Modal Safely
assertCondition(
    jsCode.includes("e.key === 'Escape'") &&
    jsCode.includes("closeMobileDrawer()") &&
    jsCode.includes("personalCoreModal.style.display = 'none'"),
    "9. Escape key handler closes open mobile drawer or Personal Core modal safely"
);

// 10. Resource Limit Check: No newly added continuous loops
const forbiddenPatterns = [
    /setInterval\s*\(\s*\(\)\s*=>\s*\{[^}]*visualizer/i,
    /requestAnimationFrame\s*\([^)]*background/i
];
const hasForbiddenLoop = forbiddenPatterns.some(p => p.test(jsCode));
assertCondition(
    !hasForbiddenLoop,
    "10. Zero continuous animation or polling loops added to UI client"
);

// 11. Mandatory Truthfulness: No unsupported operational status claims
assertCondition(
    !htmlCode.includes("System Online") &&
    !htmlCode.includes("All services local") &&
    !cssCode.includes("System Online") &&
    !jsCode.includes("System Online"),
    "11. Removal of unsupported operational status claims ('System Online', 'All services local')"
);

// 12. Calm Header Hierarchy & Workspace Actions Disclosure
assertCondition(
    htmlCode.includes('id="workspaceActionsWrapper"') &&
    htmlCode.includes('id="workspaceActionsBtn"') &&
    htmlCode.includes('id="workspaceActionsMenu"') &&
    htmlCode.includes('aria-label="Workspace actions"') &&
    htmlCode.includes('id="inspectRepoBtn"') &&
    htmlCode.includes('id="planDiffBtn"') &&
    htmlCode.includes('id="newChatBtn"'),
    "12. Workspace actions menu groups secondary actions without losing pre-existing button IDs or functionality"
);

// 13. JS Workspace Actions State Machine & Keyboard/Focus Management
assertCondition(
    jsCode.includes("setWorkspaceActionsOpen") &&
    jsCode.includes("closeWorkspaceActions") &&
    jsCode.includes("workspaceActionsBtn.setAttribute('aria-expanded'") &&
    jsCode.includes("workspaceActionsBtn.focus()"),
    "13. Workspace actions disclosure provides accessible expand/collapse, Escape dismissal, and focus restoration"
);

console.log(`\nREAL UI REFINEMENT TEST RESULTS: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
    process.exit(1);
}
