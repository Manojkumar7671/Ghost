const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ghostUiJs = fs.readFileSync(path.join(__dirname, '../public/ghost-ui.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

console.log("--- RUNNING GHOST SERVER BOUNDARY TESTS ---");

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
    // Check Python Sandbox removed
    assertCondition(!serverJs.includes("const filePath = path.join(scriptDir, 'login_page.py');") && !serverJs.includes("fs.writeFileSync(filePath, pythonCode);"), "Synthetic file execution logic found in server.js");

    // Extract predicate function
    const predicateMatch = ghostUiJs.match(/function hasCompleteVerifiedTaskEvidence[\s\S]*?\n    \}/);
    if (predicateMatch) {
        const predicateFunc = predicateMatch[0];
        const sandbox = { result: false };
        vm.createContext(sandbox);
        
        const testPredicate = (data) => {
            const code = `
                ${predicateFunc}
                result = hasCompleteVerifiedTaskEvidence(${JSON.stringify(data)});
            `;
            vm.runInContext(code, sandbox);
            return sandbox.result;
        };

        // 1 & 2 & 5. Plain assistant code, malformed evidence, missing fields are rejected
        assertCondition(!testPredicate(null), "Null data passed");
        assertCondition(!testPredicate({ text: "Write python code" }), "Plain text passed");
        assertCondition(!testPredicate({ text: "Tool Execution Results\nWritten to file ~/Ghost/scripts/login_page.py" }), "Fake tool result text passed");
        
        // Malformed evidence
        const malformedEvidence = {
            execution: {
                taskId: "123",
                planIdentity: "xyz",
                state: "running"
            }
        };
        assertCondition(!testPredicate(malformedEvidence), "Partial evidence passed");

        // 6. Complete structured verified-evidence fixture passes
        const completeEvidence = {
            execution: {
                taskId: "task_123",
                planIdentity: "plan_456",
                verifiedStatus: "success",
                state: "succeeded",
                evidenceFlag: true,
                artifacts: [
                    { artifactId: "art_1", type: "code", content: "print('hello')" }
                ]
            }
        };
        assertCondition(testPredicate(completeEvidence), "Complete evidence rejected");
        
        // 3. Ordinary chat code request fallback verification
        const falseClaimMatch = serverJs.match(/const falseClaimPatterns = \[([\s\S]*?)\];/);
        if (falseClaimMatch) {
            const patternsStr = falseClaimMatch[1];
            vm.runInContext(`
                {
                    const patterns = [${patternsStr}];
                    result = patterns.some(pattern => pattern.test("Here is a simple Python login-page example. I have not run it."));
                }
            `, sandbox);
            assertCondition(!sandbox.result, "Ordinary code request triggered false claim fallback");
            
            vm.runInContext(`
                {
                    const patterns = [${patternsStr}];
                    result = patterns.some(pattern => pattern.test("I generated and executed this script."));
                }
            `, sandbox);
            assertCondition(sandbox.result, "Dangerous claim did not trigger fallback");
        } else {
            assertCondition(false, "Could not extract falseClaimPatterns from server.js");
        }
    } else {
        assertCondition(false, "hasCompleteVerifiedTaskEvidence predicate not found in ghost-ui.js");
    }

    // 4. Ordinary chat never calls Task Trace or artifact panel
    assertCondition(ghostUiJs.includes("if (hasCompleteVerifiedTaskEvidence(data) && isAdminMode) { renderTaskTrace"), "Task trace not gated by predicate");

    // 7. Safe text API for artifacts
    const panelMatch = ghostUiJs.match(/function openVerifiedArtifactPanel[\s\S]*?\n    \}/);
    assertCondition(panelMatch && panelMatch[0].includes("codeContent.textContent = artifact.content"), "Artifacts using unsafe HTML assignment");
    
    // 8. Timeout cleanup and UI recovery on all outcomes
    assertCondition(ghostUiJs.includes("finally {\n            setChatBusy(false);\n        }"), "Missing finally block for UI recovery");
    assertCondition(ghostUiJs.includes("clearTimeout(timeoutId)"), "Timeout not cleared");

    // 9 & 10. Guards remain unchanged
    assertCondition(ghostUiJs.includes("['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)"), "Localhost guard weakened");
    assertCondition(serverJs.includes("const isPublic = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public'"), "Public deployment guard weakened");

    console.log(`SERVER_EVIDENCE_BOUNDARY_TESTS: ${passedCount} passed, ${failedCount} failed`);
    if (failedCount > 0) process.exit(1);
    else process.exit(0);

} catch (err) {
    console.error("BLOCKED: Test execution error: " + err.message);
    process.exit(1);
}
