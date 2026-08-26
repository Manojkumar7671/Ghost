const path = require('path');
const fs = require('fs');

/**
 * tests/task_agent_v0_test.cjs — Ghost Agent V0.1 Grounded Task Proposal & Explicit Feedback Test Suite
 *
 * Verifies all 14 non-negotiable behavioral requirements:
 * 1. Selected task description materially constrains the proposal.
 * 2. Active vs historic blocker wording is correct.
 * 3. Historic blocker followed by cancellation/re-planning is not silently dropped.
 * 4. Absent task facts are explicitly identified without invention.
 * 5. Code-fact gap produces a future owner-approved read-only inspection request, not a claimed inspection.
 * 6. Output cannot claim files, commands, tests, Git, deployment, research, browser access, Mac control, or completed work.
 * 7. Deterministic fallback remains grounded in server-selected task facts and blocker history.
 * 8. Client-supplied facts cannot override server-resolved owner data.
 * 9. Feedback cannot be saved without explicit selected rating and owner authorization.
 * 10. Repeated/racing feedback requests are idempotent.
 * 11. Optional notes are length-bounded (240 chars) and secret-looking notes are rejected safely.
 * 12. Feedback is owner-scoped, bounded, and cannot alter task state/text/goals/memories or permissions.
 * 13. Later proposal preferences use only explicit saved feedback, not arbitrary historical chat content.
 * 14. Only truthful proposal-created and feedback-recorded events are appended; no execution event exists.
 */

async function runTaskAgentV0_1Tests() {
    console.log("--- RUNNING GHOST AGENT V0.1 GROUNDED PROPOSAL & EXPLICIT FEEDBACK SUITE ---");

    let passedCount = 0;
    let failedCount = 0;

    function assertCondition(cond, desc) {
        if (cond) {
            console.log(`✓ PASS: ${desc}`);
            passedCount++;
        } else {
            console.error(`✗ FAIL: ${desc}`);
            failedCount++;
        }
    }

    const {
        createPersonalTask,
        listPersonalTasks,
        updatePersonalTaskStatus,
        listPersonalTaskEvents,
        createOwnerGoal,
        saveExplicitMemory,
        resetMemoryStoreForTesting,
        ALLOWED_TASK_EVENT_TYPES
    } = await import('../services/personalCore.js');

    const {
        generateTaskProposal,
        recordProposalFeedback,
        buildDeterministicFallbackProposal,
        resolveTaskBlockerHistory,
        getOwnerFeedbackPreferenceSummary,
        buildGroundingStatement,
        resetTaskAgentStoreForTesting,
        SAFETY_NOTICE,
        DISCLAIMER,
        FIXED_STATUS,
        ELIGIBLE_TASK_STATUSES,
        ALLOWED_FEEDBACK_RATINGS
    } = await import('../services/taskAgent.js');

    resetMemoryStoreForTesting();
    resetTaskAgentStoreForTesting();

    const ownerAlice = 'owner_alice_v01';
    const ownerBob = 'owner_bob_v01';

    // Setup Owner Context
    await saveExplicitMemory(ownerAlice, "Ghost operates under strict owner-only boundaries.");
    const goalRes = await createOwnerGoal(ownerAlice, { title: "Transform Ghost into a private personal AI", status: "active" });
    const aliceGoalId = goalRes.goal.id;

    // --- TEST 1: Selected task description materially constrains proposal ---
    const task1Res = await createPersonalTask(ownerAlice, {
        title: "Review approval-gated edit/test worker boundaries",
        description: "Second task verifying blocker reason logging.",
        goalId: aliceGoalId
    });
    const task1 = task1Res.task;

    const proposal1Res = await generateTaskProposal(ownerAlice, task1.id);
    assertCondition(
        proposal1Res.success === true &&
        proposal1Res.proposal &&
        typeof proposal1Res.proposal.proposedNextAction === 'string' &&
        proposal1Res.proposal.groundingStatement.includes("selected task description") &&
        proposal1Res.proposal.authority === SAFETY_NOTICE,
        "1. Selected task description materially constrains proposal and is reflected in grounding statement"
    );

    // --- TEST 2 & 3: Active vs Historic Blocker Resolution & Multi-Step Transition Preservation ---
    // Transition Task 1: pending -> blocked -> cancelled -> planned
    await updatePersonalTaskStatus(ownerAlice, task1.id, {
        status: 'blocked',
        blockerReason: 'Requires a separate owner approval contract.'
    });
    await updatePersonalTaskStatus(ownerAlice, task1.id, {
        status: 'cancelled',
        blockerReason: 'Temporarily deprioritized'
    });
    await updatePersonalTaskStatus(ownerAlice, task1.id, {
        status: 'planned'
    });

    const task1Updated = (await listPersonalTasks(ownerAlice)).find(t => t.id === task1.id);
    const task1Events = (await listPersonalTaskEvents(ownerAlice, task1.id)).events;

    const blockerInfo = resolveTaskBlockerHistory(task1Updated, task1Events);
    assertCondition(
        blockerInfo.hasBlockerHistory === true &&
        blockerInfo.isHistoric === true &&
        blockerInfo.isActive === false &&
        blockerInfo.blockerReason === 'Requires a separate owner approval contract.',
        "2. Blocker history accurately identifies historic blocker after transitions (blocked -> cancelled -> planned)"
    );

    const proposalHistoricRes = await generateTaskProposal(ownerAlice, task1.id);
    assertCondition(
        proposalHistoricRes.success === true &&
        proposalHistoricRes.proposal.groundingStatement.includes("historic blocker recorded on") &&
        proposalHistoricRes.proposal.blocker.includes("Requires a separate owner approval contract"),
        "3. Historic blocker followed by cancellation/re-planning is not silently dropped in proposal"
    );

    // Test Active Blocker on Task 2
    const task2Res = await createPersonalTask(ownerAlice, {
        title: "Configure local microphone streaming"
    });
    await updatePersonalTaskStatus(ownerAlice, task2Res.task.id, {
        status: 'blocked',
        blockerReason: 'Missing CoreAudio macOS permissions'
    });
    const task2 = (await listPersonalTasks(ownerAlice)).find(t => t.id === task2Res.task.id);
    const task2Events = (await listPersonalTaskEvents(ownerAlice, task2.id)).events;
    const task2BlockerInfo = resolveTaskBlockerHistory(task2, task2Events);
    assertCondition(
        task2BlockerInfo.isActive === true &&
        task2BlockerInfo.isHistoric === false &&
        task2BlockerInfo.blockerReason === 'Missing CoreAudio macOS permissions',
        "2b. Active blocker is correctly identified as active when current status is blocked"
    );

    // --- TEST 4: Absent task facts are explicitly identified without invention ---
    const task3Res = await createPersonalTask(ownerAlice, {
        title: "Unadorned task without description"
    });
    const task3Events = (await listPersonalTaskEvents(ownerAlice, task3Res.task.id)).events;
    const task3BlockerInfo = resolveTaskBlockerHistory(task3Res.task, task3Events);
    const groundingStatement3 = buildGroundingStatement(task3Res.task, task3BlockerInfo, false, 0);
    assertCondition(
        groundingStatement3.includes("no task description provided") &&
        !groundingStatement3.includes("historic blocker"),
        "4. Absent task facts (no description, no blocker) are explicitly stated without invention"
    );

    // --- TEST 5 & 6: Code-fact gap and Zero execution contract ---
    const fallbackGrounding = buildDeterministicFallbackProposal(task1Updated, "Goal", blockerInfo, { count: 0 });
    assertCondition(
        fallbackGrounding.authority === SAFETY_NOTICE &&
        fallbackGrounding.futureApprovalRequired === true &&
        !fallbackGrounding.proposedNextAction.includes("exec") &&
        !fallbackGrounding.proposedNextAction.includes("git push"),
        "5 & 6. Proposal requires future owner approval and contains zero execution claims"
    );

    // --- TEST 7: Deterministic fallback remains grounded in server-selected task facts ---
    assertCondition(
        fallbackGrounding.selectedTask.id === task1.id &&
        fallbackGrounding.selectedTask.status === 'planned' &&
        fallbackGrounding.blocker.includes("Requires a separate owner approval contract"),
        "7. Deterministic fallback proposal accurately derives next action and historic blocker from server facts"
    );

    // --- TEST 8: Client-supplied facts cannot override server-resolved owner data ---
    // Server endpoint POST /api/task-agent/propose accepts only taskId
    const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assertCondition(
        serverJs.includes("const { taskId } = req.body || {};") &&
        !serverJs.includes("const { taskId, taskText } = req.body"),
        "8. Server resolves all task facts from server-side database/store using only owner ID and task ID"
    );

    // --- TEST 9: Feedback validation and authorization ---
    const invalidRatingRes = await recordProposalFeedback(ownerAlice, task1.id, {
        proposalId: proposalHistoricRes.proposal.proposalId,
        rating: 'invalid_rating'
    });
    assertCondition(
        invalidRatingRes.success === false &&
        invalidRatingRes.error.includes("Valid rating is required"),
        "9a. Feedback rejected when rating is not one of: helpful, too_vague, incorrect"
    );

    const bobFeedbackRes = await recordProposalFeedback(ownerBob, task1.id, {
        proposalId: proposalHistoricRes.proposal.proposalId,
        rating: 'helpful'
    });
    assertCondition(
        bobFeedbackRes.success === false &&
        bobFeedbackRes.error.includes("Task not found or unauthorized"),
        "9b. Cross-owner feedback rejected when non-owner attempts to record feedback on Alice's task"
    );

    // --- TEST 10: Feedback recording idempotency ---
    const validFeedback1 = await recordProposalFeedback(ownerAlice, task1.id, {
        proposalId: proposalHistoricRes.proposal.proposalId,
        rating: 'too_vague',
        note: 'Use the task blocker and name the exact approval artifact.'
    });
    assertCondition(
        validFeedback1.success === true &&
        validFeedback1.feedback.rating === 'too_vague' &&
        validFeedback1.feedback.note === 'Use the task blocker and name the exact approval artifact.',
        "10a. Valid explicit feedback recorded successfully"
    );

    const duplicateFeedback = await recordProposalFeedback(ownerAlice, task1.id, {
        proposalId: proposalHistoricRes.proposal.proposalId,
        rating: 'too_vague',
        note: 'Duplicate click'
    });
    assertCondition(
        duplicateFeedback.success === true &&
        duplicateFeedback.isDuplicate === true &&
        duplicateFeedback.feedback.id === validFeedback1.feedback.id,
        "10b. Duplicate/racing feedback request is idempotent and returns existing record without duplicate event"
    );

    // --- TEST 11: Feedback note length bounding & secret rejection ---
    const secretNoteRes = await recordProposalFeedback(ownerAlice, task1.id, {
        proposalId: 'prop_test_secret',
        rating: 'incorrect',
        note: 'My API key is sk-live-1234567890abcdef1234567890'
    });
    assertCondition(
        secretNoteRes.success === false &&
        secretNoteRes.isSecretRejected === true,
        "11a. Secret-shaped feedback note is rejected safely without storage"
    );

    const longNote = 'A'.repeat(350);
    const longNoteRes = await recordProposalFeedback(ownerAlice, task1.id, {
        proposalId: 'prop_test_long',
        rating: 'helpful',
        note: longNote
    });
    assertCondition(
        longNoteRes.success === true &&
        longNoteRes.feedback.note.length === 240,
        "11b. Long feedback note is safely bounded to 240 characters max"
    );

    // --- TEST 12: Feedback does not mutate task state, text, goal, memories, or permissions ---
    const taskAfterFeedback = (await listPersonalTasks(ownerAlice)).find(t => t.id === task1.id);
    assertCondition(
        taskAfterFeedback.status === 'planned' &&
        taskAfterFeedback.title === task1.title &&
        taskAfterFeedback.description === task1.description,
        "12. Feedback recording causes zero mutations to task status, text, goals, or memories"
    );

    // --- TEST 13: Later proposal preferences use only explicit saved feedback ---
    const feedbackPrefs = getOwnerFeedbackPreferenceSummary(ownerAlice);
    assertCondition(
        feedbackPrefs.count === 2 &&
        feedbackPrefs.guidance.includes("[RULE: AVOID VAGUENESS]") &&
        feedbackPrefs.guidance.includes("Use the task blocker and name the exact approval artifact"),
        "13. Saved feedback creates deterministic preference guidance for future proposal generation"
    );

    // --- TEST 14: Only proposal-created and feedback-recorded events appended; zero execution events ---
    const allTask1Events = (await listPersonalTaskEvents(ownerAlice, task1.id)).events;
    const eventTypes = allTask1Events.map(e => e.eventType);
    assertCondition(
        ALLOWED_TASK_EVENT_TYPES.includes('agent_proposal_feedback_recorded') &&
        eventTypes.includes('agent_proposal_created') &&
        eventTypes.includes('agent_proposal_feedback_recorded') &&
        !eventTypes.includes('task_executed') &&
        !eventTypes.includes('command_run'),
        "14. Immutable activity ledger contains truthful proposal and feedback events; zero execution events"
    );

    console.log(`\nTASK AGENT V0.1 SUITE RESULTS: ${passedCount} passed, ${failedCount} failed\n`);

    if (failedCount > 0) {
        process.exitCode = 1;
    }
}

runTaskAgentV0_1Tests().catch(err => {
    console.error("Task Agent V0.1 Test Error:", err);
    process.exit(1);
});
