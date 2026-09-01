/**
 * tests/autonomy_foundations_v0_test.cjs
 *
 * Focused offline CommonJS static and logic test for Autonomy Foundations V0.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const serverSource = fs.readFileSync(serverPath, 'utf8');

    const planMatchStr = 'const preparePlanMatch = message.match(/^prepare\\s+plan:\\s*(.*)$/i);';
    const planBlockStart = serverSource.indexOf(planMatchStr);
    assert.ok(planBlockStart !== -1, "Must match exactly `prepare plan: <goal>`");

    const endOfBlockStr = 'let approvedPersonalContext = null;';
    const authStart = serverSource.indexOf(endOfBlockStr, planBlockStart);
    const planBlock = serverSource.slice(planBlockStart, authStart);

    // 1. empty goals fail closed
    assert.ok(planBlock.includes('if (!rawGoal)'), "Empty goals must fail closed");

    // 2. Planning occurs before transient proposal creation
    const generatePlanIdx = planBlock.indexOf('generateTechnicalPlan(');
    const createProposalIdx = planBlock.indexOf('createTaskProposal(');
    assert.ok(generatePlanIdx !== -1 && createProposalIdx !== -1, "Must call generateTechnicalPlan and createTaskProposal");
    assert.ok(generatePlanIdx < createProposalIdx, "Planning must occur before proposal creation");

    // 3. Canonical owner authentication/owner ID is used
    assert.ok(planBlock.includes('authenticateOwner(req)'), "Must authenticate owner");
    assert.ok(planBlock.includes('createTaskProposal(chatOwner.ownerId,'), "Must use canonical chatOwner.ownerId");

    // 4. Response preserves all four fields and returns proposedTask shape
    assert.ok(planBlock.includes('success: true'), "Response must include success");
    assert.ok(planBlock.includes('text: applyEvidenceWrapper('), "Response must include text");
    assert.ok(planBlock.includes('runId:'), "Response must include runId");
    assert.ok(planBlock.includes('execution: {'), "Response must include execution");
    assert.ok(planBlock.includes('proposedTask: {'), "Response must include proposedTask");
    assert.ok(planBlock.includes('proposalId: prop.proposalId'), "proposedTask must have proposalId");

    // 4.5. Transient proposal failure handling
    const proposalFailCheckIdx = planBlock.indexOf('if (!proposalRes.success)');
    const proposalAccessIdx = planBlock.indexOf('proposalRes.proposal');
    assert.ok(proposalFailCheckIdx !== -1, "Must check !proposalRes.success");
    assert.ok(proposalAccessIdx !== -1, "Must access proposalRes.proposal on success");
    assert.ok(proposalFailCheckIdx < proposalAccessIdx, "Must check for proposal failure before accessing proposal fields");

    const proposalFailBlockStart = planBlock.indexOf('{', proposalFailCheckIdx);
    const proposalFailBlockEnd = planBlock.indexOf('const prop = proposalRes.proposal;', proposalFailBlockStart);
    const proposalFailBlock = planBlock.slice(proposalFailBlockStart, proposalFailBlockEnd);

    assert.ok(proposalFailBlock.includes('success:'), "Proposal failure response must include success");
    assert.ok(proposalFailBlock.includes('text:'), "Proposal failure response must include text");
    assert.ok(proposalFailBlock.includes('runId:'), "Proposal failure response must include runId");
    assert.ok(proposalFailBlock.includes('execution: {'), "Proposal failure response must include execution");
    assert.ok(!proposalFailBlock.includes('proposedTask:'), "Proposal failure response must NOT include proposedTask");

    // 5. No task is persisted before confirmation
    // 6. Contains no createPersonalTask, draftApprovalContract, etc.
    const forbidden = [
        'createPersonalTask(', 
        'draftApprovalContract(', 
        'reviewApprovalContract(', 
        'cancelApprovalContract(',
        'exec(', 
        'spawn(', 
        'fetch(', 
        'setTimeout(', 
        'setInterval('
    ];
    for (const f of forbidden) {
        assert.ok(!planBlock.includes(f), `Must not contain ${f}`);
    }

    // 7. Existing mission behavior is not changed
    assert.ok(serverSource.includes('const isMissionIntent = /^mission(?:\\s+|:\\s*)(.*)$/i.test(message);'), "Existing mission route must remain unchanged");

    // 8. Ghost UI post-confirmation status wording audit (offline static read)
    const uiPath = path.join(__dirname, '..', 'public', 'ghost-ui.js');
    const uiSource = fs.readFileSync(uiPath, 'utf8');

    const OLD_WORDING = 'Task remembered in your workspace (Status: pending).';
    const NEW_WORDING = 'Pending plan record created \u2014 no actions were executed.';
    const CONFIRMATION_GATE = 'if (res.ok && data.success && data.task) {';
    // Unique string present only inside the success branch, immediately before the closing `} else {`
    const SUCCESS_BLOCK_END_MARKER = '} else {';

    // Old wording must be gone from the entire file
    assert.ok(!uiSource.includes(OLD_WORDING), "ghost-ui.js must no longer contain the old status sentence");

    // Locate the success gate
    const gateIdx = uiSource.indexOf(CONFIRMATION_GATE);
    assert.ok(gateIdx !== -1, "Confirmation gate must still exist in ghost-ui.js");

    // Extract the success block: from after the gate opening brace through the first `} else {`
    const successBlockStart = gateIdx + CONFIRMATION_GATE.length;
    const successBlockEnd = uiSource.indexOf(SUCCESS_BLOCK_END_MARKER, successBlockStart);
    assert.ok(successBlockEnd !== -1, "Success block must be followed by the else branch");
    const successBlock = uiSource.slice(successBlockStart, successBlockEnd);

    // New wording must be inside the extracted success block
    assert.ok(successBlock.includes(NEW_WORDING), "New wording must be inside the res.ok && data.success && data.task success block");

    // New wording must not appear before the gate index in the full source
    const newWordingIdx = uiSource.indexOf(NEW_WORDING);
    assert.ok(newWordingIdx > gateIdx, "New wording must not appear before the confirmation gate in ghost-ui.js");

    console.log("ALL AUTONOMY FOUNDATIONS V0 STATIC TESTS PASSED.");
}

runTests();
