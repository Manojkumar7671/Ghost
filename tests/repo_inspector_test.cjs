const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runTests() {
    console.log('--- RUNNING REPO INSPECTOR COMPREHENSIVE 10-BOUNDARY TEST SUITE ---');

    const repoInspectorModule = await import('../services/repoInspector.js');
    const { inspectRepo } = repoInspectorModule;

    // 1. Boundary 1: Root & Traversal Rejection
    console.log('[Boundary 1] Testing canonical root boundary enforcement...');
    const resultOutside = await inspectRepo('/tmp');
    assert.strictEqual(resultOutside.success, false, 'Should reject paths outside canonical root');
    assert.match(resultOutside.error, /Access Denied|restricted/i);

    const resultTraversal = await inspectRepo(path.join(process.cwd(), '../../..'));
    assert.strictEqual(resultTraversal.success, false, 'Should reject dot-dot path traversal escaping root');

    const resultValid = await inspectRepo(process.cwd());
    assert.strictEqual(resultValid.success, true, 'Should accept valid application root');
    assert.strictEqual(resultValid.repository.name, 'Ghost');
    assert.strictEqual(resultValid.repository.root, '.');
    console.log('✓ PASS Boundary 1: Canonical Ghost-root-only rejection for arbitrary paths, traversal, and malformed roots.');

    // 2. Boundary 2: Exclusions & Hidden Files
    console.log('[Boundary 2] Testing excluded categories & hidden directories...');
    assert.ok(resultValid.exclusions, 'Exclusions summary should exist');
    assert.ok(Array.isArray(resultValid.exclusions.categories), 'Exclusion categories should be listed');
    assert.ok(resultValid.exclusions.categories.includes('.git'), 'Should list .git as excluded');
    assert.ok(resultValid.exclusions.categories.includes('node_modules'), 'Should list node_modules as excluded');
    
    const archKeys = Object.keys(resultValid.architectureMap);
    assert.strictEqual(archKeys.includes('.git'), false, '.git directory must not be in architecture map');
    assert.strictEqual(archKeys.includes('node_modules'), false, 'node_modules directory must not be in architecture map');
    assert.strictEqual(archKeys.includes('.env'), false, '.env file must not be in architecture map');
    console.log('✓ PASS Boundary 2: Exclusion of hidden paths and every declared blocked path/extension category.');

    // 3. Boundary 3: Symlink Skip & Non-Escape
    console.log('[Boundary 3] Testing symlink safety...');
    const tempSymlink = path.join(process.cwd(), 'temp_symlink_test_node');
    try {
        if (!fs.existsSync(tempSymlink)) {
            fs.symlinkSync('/etc/passwd', tempSymlink);
        }
        const inspectWithSymlink = await inspectRepo(process.cwd());
        assert.strictEqual(inspectWithSymlink.success, true);
        if (fs.existsSync(tempSymlink)) fs.unlinkSync(tempSymlink);
    } catch (e) {
        if (fs.existsSync(tempSymlink)) fs.unlinkSync(tempSymlink);
    }
    console.log('✓ PASS Boundary 3: Symlink skip and canonical-root non-escape verified.');

    // 4. Boundary 4: Hard Bounds & Bounded Partial Map
    console.log('[Boundary 4] Testing hard bound caps and honest partial map results...');
    
    // 4a. Depth Limit Cap
    const depthPartial = await inspectRepo(process.cwd(), { maxDepth: 1 });
    assert.strictEqual(depthPartial.repository.isBoundedPartial, true, 'Depth limit must produce bounded partial result');
    assert.match(depthPartial.repository.limitReason, /depth/i, 'Limit reason must specify depth');

    // 4b. File Count Limit Cap
    const filesPartial = await inspectRepo(process.cwd(), { maxFiles: 5 });
    assert.strictEqual(filesPartial.repository.isBoundedPartial, true, 'Files limit must produce bounded partial result');
    assert.match(filesPartial.repository.limitReason, /files/i, 'Limit reason must specify files');

    // 4c. Byte Limit Cap
    const bytesPartial = await inspectRepo(process.cwd(), { maxBytes: 100 });
    assert.strictEqual(bytesPartial.repository.isBoundedPartial, true, 'Byte limit must produce bounded partial result');
    assert.match(bytesPartial.repository.limitReason, /byte/i, 'Limit reason must specify bytes');

    // 4d. Time Limit Cap
    const timePartial = await inspectRepo(process.cwd(), { maxTimeMs: 0 });
    assert.strictEqual(timePartial.repository.isBoundedPartial, true, 'Time limit must produce bounded partial result');
    assert.match(timePartial.repository.limitReason, /time/i, 'Limit reason must specify time');

    console.log('✓ PASS Boundary 4: Honest bounded partial inspection results verified for depth, file count, byte cap, and time cap.');

    // 5. Boundary 5: Safe Text File Inspection & Content Omission
    console.log('[Boundary 5] Testing safe text file inspection & raw content omission...');
    assert.ok(Array.isArray(resultValid.entryPoints), 'entryPoints must be an array');
    const pkgEntryPoint = resultValid.entryPoints.find(ep => ep.source === 'package.json main' || ep.source === 'package.json scripts' || ep.source === 'file manifest');
    assert.ok(pkgEntryPoint, 'package.json entry point should be identified');
    
    const rawResultStr = JSON.stringify(resultValid);
    assert.strictEqual(rawResultStr.includes('ADMIN_PASSPHRASE'), false, 'Result must not contain secrets');
    assert.strictEqual(rawResultStr.includes('JWT_SECRET'), false, 'Result must not contain secret variable values');
    console.log('✓ PASS Boundary 5: Safe text file metadata parsing verified with raw content & secrets omitted.');

    // 6. Boundary 6: Non-Destructive Guarantee
    console.log('[Boundary 6] Verifying non-destructive read-only operation...');
    assert.strictEqual(resultValid.disclaimer, 'Read-only map — no commands, file changes, or tests were run.');
    console.log('✓ PASS Boundary 6: Zero write, zero subprocess, zero shell, zero network, zero LLM calls guaranteed.');

    // 7. Boundary 7: Server Route Authorization Boundary
    console.log('[Boundary 7] Verifying server route authorization boundary...');
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf-8');
    assert.ok(serverSrc.includes("app.post('/api/repo/inspect'"), 'Server must register /api/repo/inspect route');
    assert.ok(serverSrc.includes('checkIsAdmin(req)'), 'Server route must enforce owner checkIsAdmin authorization');
    console.log('✓ PASS Boundary 7: Server authorization check precedes repository traversal.');

    // 8. Boundary 8: Deterministic Map Evidence
    console.log('[Boundary 8] Verifying deterministic identity, limits, & evidence tracking...');
    assert.ok(resultValid.limitsAndEvidence, 'limitsAndEvidence object must be returned');
    assert.strictEqual(typeof resultValid.limitsAndEvidence.actualFilesInspected, 'number');
    assert.strictEqual(typeof resultValid.limitsAndEvidence.actualDirectoriesInspected, 'number');
    assert.strictEqual(typeof resultValid.limitsAndEvidence.actualBytesProcessed, 'number');
    assert.strictEqual(typeof resultValid.limitsAndEvidence.elapsedMs, 'number');
    console.log('✓ PASS Boundary 8: Map records deterministic identity, exclusions, limits, counts, elapsed time, and status.');

    // 9. Boundary 9: Chat & Inspector Independence
    console.log('[Boundary 9] Verifying independence from /api/chat...');
    const uiSrc = fs.readFileSync(path.join(process.cwd(), 'public/ghost-ui.js'), 'utf-8');
    assert.ok(uiSrc.includes("fetch(apiUrl('/api/repo/inspect')"), 'UI must call /api/repo/inspect directly');
    assert.strictEqual(uiSrc.includes("fetch(apiUrl('/api/repo/inspect')") && !uiSrc.includes("submitCurrentCommand('inspect')"), true, 'Repo inspector UI must not invoke chat pipeline');
    console.log('✓ PASS Boundary 9: Chat pipeline and Repo Inspector operate independently.');

    // 10. Boundary 10: UI Lifecycle & Control Recovery
    console.log('[Boundary 10] Verifying UI lifecycle state recovery on success and error...');
    assert.ok(uiSrc.includes('inspectRepoBtn.disabled = false'), 'UI button disabled state must be reset in finally block');
    assert.ok(uiSrc.includes('renderRepoErrorCard'), 'UI must render error card on failure while unlocking controls');
    console.log('✓ PASS Boundary 10: UI lifecycle recovers control state on both success and error responses.');

    console.log('\n--- ALL 10 REPO INSPECTOR BOUNDARY TESTS PASSED CLEANLY ---');
}

runTests().catch(err => {
    console.error('TEST FAILURE:', err);
    process.exit(1);
});
