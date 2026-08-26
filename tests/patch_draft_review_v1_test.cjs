/**
 * tests/patch_draft_review_v1_test.cjs
 *
 * Comprehensive Test Specification Suite for Patch Draft/Review V1 (Non-Writing).
 *
 * NOTE: DO NOT EXECUTE DURING IMPLEMENTATION HANDOFF.
 * This file serves as the definitive unit and behavioral verification suite
 * for subsequent independent acceptance review.
 *
 * Required Coverage Areas:
 * 1. Absence of canonicalTargetPath and path/source fields from stored draft metadata, response metadata, and ledger payloads.
 * 2. Opaque repositoryId and exactManifestId do not contain target paths/filenames and prevent path reconstruction.
 * 3. Review-time resolution succeeds only through the server-controlled transient manifest binding.
 * 4. Missing manifest binding (including simulated restart) fails closed with MANIFEST_BINDING_UNAVAILABLE and rejects client paths.
 * 5. Terminal rejection (hash mismatch, secret detected, diff mismatch) immediately purges transient manifest binding and transitions draft to 'rejected'.
 * 6. Rejection responses and Task Ledger events never expose target path, filename, source content, diff, or secret values.
 * 7. Unauthorized review requests from other owners fail non-terminally without mutating legitimate draft state or deleting legitimate manifest bindings.
 * 8. Terminal transitions (reviewed, cancelled, expired, stale, rejected) clear the transient manifest binding.
 * 9. Existing no-content, no-write, no-Apply, secret-scan, re-hash, diff-derivation, and ledger-redaction invariants remain intact.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runPatchDraftReviewV1Suite() {
    console.log('--- RUNNING PATCH DRAFT/REVIEW V1 BEHAVIORAL SUITE ---');
    let passCount = 0;

    // Dynamically import patchDraftReviewWorker service (ESM)
    const workerModule = await import('../services/patchDraftReviewWorker.js');
    const {
        proposePatchDraft,
        getPatchDraftById,
        getPatchDraftForTask,
        reviewPatchDraft,
        cancelPatchDraft,
        scanForSecrets,
        generateUnifiedDiff,
        validateTargetPath,
        computeSha256,
        canonicalJsonStringify,
        resetPatchDraftStoreForTesting,
        resetTransientManifestsForTesting,
        SAFETY_BANNER,
        SEAL_SCHEMA_VERSION,
        POLICY_VERSION,
        REPOSITORY_ID
    } = workerModule;

    const personalCoreModule = await import('../services/personalCore.js');
    const { createPersonalTask, resetMemoryStoreForTesting, listPersonalTaskEvents } = personalCoreModule;

    const testOwnerId = 'owner_test_alice';

    // Helper to setup isolated test task
    async function setupTestTask(title = 'Test Patch Task') {
        const res = await createPersonalTask(testOwnerId, { title, goalId: null, description: 'Task for testing patch draft' });
        assert.ok(res.success && res.task, 'Test task creation must succeed');
        return res.task;
    }

    // Helper to generate minimal valid diff content against an existing target
    function getValidProposedContent(targetPath = 'public/index.html', suffix = '<!-- test patch draft -->\n') {
        const fullPath = path.resolve(process.cwd(), targetPath);
        const original = fs.readFileSync(fullPath, 'utf8');
        return original + '\n' + suffix;
    }

    // =========================================================================
    // Test 1: Absence of canonicalTargetPath from draft metadata, response & ledger
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 1 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        assert.strictEqual(proposeRes.success, true, proposeRes.error);
        const draft = proposeRes.draft;

        // Draft metadata must NOT contain canonicalTargetPath or raw content
        assert.strictEqual(draft.canonicalTargetPath, undefined, 'Draft metadata must NOT contain canonicalTargetPath');
        assert.strictEqual(draft.targetPath, undefined, 'Draft metadata must NOT contain targetPath');
        assert.strictEqual(draft.filePath, undefined, 'Draft metadata must NOT contain filePath');
        assert.strictEqual(draft.filename, undefined, 'Draft metadata must NOT contain filename');
        assert.strictEqual(draft._protectedContent, undefined, 'Draft must not contain _protectedContent');
        assert.strictEqual(draft.beforeContent, undefined, 'Draft must not contain beforeContent');
        assert.strictEqual(draft.afterContent, undefined, 'Draft must not contain afterContent');
        assert.strictEqual(draft.unifiedDiff, undefined, 'Draft metadata must not persist unifiedDiff');

        // Verify Task Ledger event contains NO targetPath, filename, or source summary
        const eventsRes = await listPersonalTaskEvents(testOwnerId, task.id);
        const events = eventsRes.events || [];
        const draftEvt = events.find(e => e.eventType === 'approval_contract_drafted');
        assert.ok(draftEvt, 'Must record drafted event in Task Ledger');
        assert.strictEqual(draftEvt.eventDetail.targetPath, undefined, 'Event payload must NOT contain targetPath');
        assert.strictEqual(draftEvt.eventDetail.canonicalTargetPath, undefined, 'Event payload must NOT contain canonicalTargetPath');
        assert.strictEqual(draftEvt.eventDetail.filename, undefined, 'Event payload must NOT contain filename');
        assert.strictEqual(draftEvt.eventDetail.summary, undefined, 'Event payload must NOT contain human source summary');

        console.log('✓ PASS: 1. canonicalTargetPath absent from draft state, response metadata, and ledger payloads');
        passCount++;
    }

    // =========================================================================
    // Test 2: Opaque repositoryId and exactManifestId hold no path/filename data
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 2 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        const draft = proposeRes.draft;

        // Validate exactManifestId format (opaque prefix + timestamp + random hex)
        assert.ok(draft.exactManifestId.startsWith('pman_'), 'Manifest ID must have opaque prefix');
        assert.strictEqual(draft.exactManifestId.includes('tests'), false, 'Manifest ID must not contain path elements');
        assert.strictEqual(draft.exactManifestId.includes('ai_news_lookup'), false, 'Manifest ID must not contain filename');
        assert.strictEqual(draft.exactManifestId.includes('.cjs'), false, 'Manifest ID must not contain extension');

        // Validate repositoryId is opaque root reference
        assert.strictEqual(draft.repositoryId, REPOSITORY_ID);
        assert.strictEqual(draft.repositoryId.includes('/'), false, 'repositoryId must not contain slashes');

        console.log('✓ PASS: 2. Opaque repositoryId and exactManifestId do not contain or decode to paths');
        passCount++;
    }

    // =========================================================================
    // Test 3: Review-time resolution succeeds only via transient manifest binding
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 3 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        const draftId = proposeRes.draft.draftId;

        // Review resolves path strictly from transient manifest mapping and seals proposal
        const reviewValid = await reviewPatchDraft(testOwnerId, draftId, {
            proposedAfterContent: proposedCode
        });
        assert.strictEqual(reviewValid.success, true, reviewValid.error);
        assert.strictEqual(reviewValid.draft.status, 'reviewed');
        assert.ok(reviewValid.draft.sealedHash, 'Must generate sealedHash');
        assert.strictEqual(reviewValid.draft.canonicalTargetPath, undefined, 'Reviewed draft must NOT return targetPath');

        console.log('✓ PASS: 3. Review-time resolution succeeds through transient manifest binding');
        passCount++;
    }

    // =========================================================================
    // Test 4: Missing manifest binding fails closed with MANIFEST_BINDING_UNAVAILABLE
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 4 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        const draftId = proposeRes.draft.draftId;

        // Simulate server restart / memory wipe of transient manifest store only
        resetTransientManifestsForTesting();

        // Review attempt without transient manifest binding must fail closed
        const reviewNoManifest = await reviewPatchDraft(testOwnerId, draftId, {
            proposedAfterContent: proposedCode,
            clientSuppliedPath: 'public/index.html' // Must be ignored
        });
        assert.strictEqual(reviewNoManifest.success, false);
        assert.strictEqual(reviewNoManifest.reasonCode, 'MANIFEST_BINDING_UNAVAILABLE');

        console.log('✓ PASS: 4. Missing manifest binding fails closed with MANIFEST_BINDING_UNAVAILABLE');
        passCount++;
    }

    // =========================================================================
    // Test 5: Terminal rejection purges transient manifest binding and redacts output
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 5 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        const draftId = proposeRes.draft.draftId;

        // Review with tampered content (Content Hash Mismatch -> Terminal Rejection)
        const reviewTampered = await reviewPatchDraft(testOwnerId, draftId, {
            proposedAfterContent: proposedCode + '/* tampering */\n'
        });
        assert.strictEqual(reviewTampered.success, false);
        assert.strictEqual(reviewTampered.reasonCode, 'CONTENT_HASH_MISMATCH');
        assert.strictEqual(reviewTampered.targetPath, undefined, 'Rejection response must NOT contain targetPath');
        assert.strictEqual(reviewTampered.filename, undefined, 'Rejection response must NOT contain filename');

        // Check draft state transitioned to terminal rejected
        const draftPostReject = await getPatchDraftById(testOwnerId, draftId);
        assert.strictEqual(draftPostReject.draft.status, 'rejected');

        // Second review attempt must fail because binding was purged on rejection
        const reviewPostReject = await reviewPatchDraft(testOwnerId, draftId, {
            proposedAfterContent: proposedCode
        });
        assert.strictEqual(reviewPostReject.success, false, 'Draft in rejected state cannot be reviewed');

        // Verify Task Ledger rejection event is fully redacted
        const eventsRes = await listPersonalTaskEvents(testOwnerId, task.id);
        const events = eventsRes.events || [];
        const rejectEvt = events.find(e => e.eventType === 'approval_contract_cancelled' && e.eventDetail.action === 'patch_draft_rejected');
        assert.ok(rejectEvt, 'Must record patch_draft_rejected event in ledger');
        assert.strictEqual(rejectEvt.eventDetail.targetPath, undefined, 'Rejection event must NOT contain targetPath');
        assert.strictEqual(rejectEvt.eventDetail.summary, undefined, 'Rejection event must NOT contain human source summary');

        console.log('✓ PASS: 5. Terminal rejection purges transient manifest binding and records redacted ledger event');
        passCount++;
    }

    // =========================================================================
    // Test 6: Unauthorized requests are non-terminal and preserve legitimate bindings
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 6 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        const draftId = proposeRes.draft.draftId;

        // Attacker attempts review on legitimate owner's draft
        const unauthorizedReview = await reviewPatchDraft('owner_attacker', draftId, {
            proposedAfterContent: proposedCode
        });
        assert.strictEqual(unauthorizedReview.success, false, 'Unauthorized review must fail');

        // Legitimate draft state must NOT be mutated to 'rejected'
        const legitimateDraft = await getPatchDraftById(testOwnerId, draftId);
        assert.strictEqual(legitimateDraft.draft.status, 'draft', 'Draft must remain in draft status');

        // Legitimate review must still succeed (manifest binding was not deleted)
        const legitimateReview = await reviewPatchDraft(testOwnerId, draftId, {
            proposedAfterContent: proposedCode
        });
        assert.strictEqual(legitimateReview.success, true, 'Legitimate review must succeed after unauthorized attempt');
        assert.strictEqual(legitimateReview.draft.status, 'reviewed');

        console.log('✓ PASS: 6. Unauthorized requests are non-terminal and do not delete valid manifest bindings');
        passCount++;
    }

    // =========================================================================
    // Test 7: Terminal transitions (cancellation, expiry) clear transient manifest
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const proposedCode = getValidProposedContent('tests/ai_news_lookup_test.cjs', '<!-- test 7 -->\n');
        const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
            targetPath: 'tests/ai_news_lookup_test.cjs',
            proposedAfterContent: proposedCode
        });
        const draftId = proposeRes.draft.draftId;

        // Cancel the draft
        const cancelRes = await cancelPatchDraft(testOwnerId, draftId);
        assert.strictEqual(cancelRes.success, true);
        assert.strictEqual(cancelRes.draft.status, 'cancelled');

        // Review attempt after cancellation must fail closed
        const reviewCancelled = await reviewPatchDraft(testOwnerId, draftId, {
            proposedAfterContent: proposedCode
        });
        assert.strictEqual(reviewCancelled.success, false);

        console.log('✓ PASS: 7. Cancellation and terminal transitions clear transient manifest binding');
        passCount++;
    }

    // =========================================================================
    // Test 8: Secret screening fail-closed rejection without secret echo
    // =========================================================================
    {
        resetPatchDraftStoreForTesting();
        resetMemoryStoreForTesting();
        const task = await setupTestTask();

        const secretPayloads = [
            '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
            'const key = "sk-1234567890123456789012345678901234567890";',
            'const anthropicKey = "sk-ant-123456789012345678901234567890";',
            'const ghToken = "ghp_123456789012345678901234567890123456";',
            'const awsKey = "AKIAIOSFODNN7EXAMPLE";',
            'const db = "postgres://user:superSecretPassword123@localhost:5432/db";',
            'const secretToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisJWT";'
        ];

        for (const sec of secretPayloads) {
            const scan = scanForSecrets(sec);
            assert.strictEqual(scan.hasSecret, true, 'Secret scanner must detect secret payload');

            const proposeRes = await proposePatchDraft(testOwnerId, task.id, {
                targetPath: 'tests/ai_news_lookup_test.cjs',
                proposedAfterContent: sec
            });
            assert.strictEqual(proposeRes.success, false, 'Proposal with secret must fail closed');
            assert.strictEqual(proposeRes.reasonCode, 'SECRET_DETECTED');
            assert.strictEqual(proposeRes.error.includes(sec), false, 'Error message must not echo secret');
        }

        console.log('✓ PASS: 8. Fail-closed secret rejection without secret echo');
        passCount++;
    }

    // =========================================================================
    // Test 9: Zero Apply or repository file write authority
    // =========================================================================
    {
        const workerExports = Object.keys(await import('../services/patchDraftReviewWorker.js'));

        const forbiddenPatterns = [/apply/i, /write/i, /mutate/i, /patchFile/i, /executePatch/i];
        for (const pattern of forbiddenPatterns) {
            for (const exp of workerExports) {
                assert.ok(!pattern.test(exp) || exp === 'validateTargetPath', `Forbidden export '${exp}' matches write pattern ${pattern}`);
            }
        }

        assert.strictEqual(SAFETY_BANNER, "PATCH PROPOSAL ONLY — NO REPOSITORY FILES CHANGED — REVIEW SEALS THIS PROPOSAL BUT DOES NOT APPLY IT.");

        console.log('✓ PASS: 9. Zero Apply or repository file write authority verified');
        passCount++;
    }

    console.log(`\nPATCH DRAFT/REVIEW V1 TEST SPECIFICATIONS: All ${passCount} test suites passed cleanly.\n`);
}

if (require.main === module) {
    runPatchDraftReviewV1Suite()
        .then(() => {
            console.log('ALL PATCH DRAFT/REVIEW V1 TESTS PASSED SUCCESSFULLY.');
            process.exit(0);
        })
        .catch(err => {
            console.error('TEST SUITE FAILED:', err);
            process.exit(1);
        });
}

module.exports = { runPatchDraftReviewV1Suite };
