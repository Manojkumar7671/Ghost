import http from 'http';
import { spawn } from 'child_process';

const PORT = 4177;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: PORT,
            path,
            method: options.method || 'GET',
            headers: options.headers || {}
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    data
                });
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
    console.log('--- GHOST SMOKE TESTS (MOCK LLM) ---');
    let allPassed = true;
    let sessionCookie = '';

    const assert = (condition, msg) => {
        if (!condition) {
            console.error(`❌ FAIL: ${msg}`);
            allPassed = false;
        } else {
            console.log(`✅ PASS: ${msg}`);
        }
    };

    try {
        // 1. GET /health
        console.log('\n[Test] GET /health');
        const healthRes = await request('/health');
        assert(healthRes.status === 200, 'Health returned HTTP 200');
        const healthData = JSON.parse(healthRes.data);
        assert(healthData.status === 'ok', 'Health status is ok');
        assert(!JSON.stringify(healthData).includes('key') && !JSON.stringify(healthData).includes('password'), 'No API keys in health response');

        // 2. Protected chat without a session
        console.log('\n[Test] Protected chat without a session');
        const chatUnauth = await request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: "Hello" })
        });
        // Might be 200 with {success: false, error: ...} or 403 depending on securityMiddleware.
        // The implementation uses securityMiddleware which checks checkIsAdmin or similar. Let's see what happens.
        assert(chatUnauth.status === 403 || chatUnauth.data.includes('"success":false'), `Unauthenticated chat rejected (Status ${chatUnauth.status})`);

        // 3. Login failure
        console.log('\n[Test] Login failure');
        const loginFail = await request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passphrase: "wrong_password" })
        });
        assert(loginFail.status === 401, `Login failure returned 401`);

        // 4. Successful test-only login
        console.log('\n[Test] Successful login');
        const loginSuccess = await request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passphrase: "test_password" }) // We'll pass ADMIN_PASSPHRASE in env
        });
        const setCookie = loginSuccess.headers['set-cookie'];
        assert(loginSuccess.status === 200 && setCookie && setCookie[0].includes('ghost_session='), 'Login succeeded and set ghost_session cookie');
        assert(setCookie[0].includes('HttpOnly'), 'Cookie is HttpOnly');
        assert(setCookie[0].includes('SameSite='), 'Cookie has SameSite');
        sessionCookie = setCookie[0].split(';')[0]; // Extract ghost_session=...

        // 5. Chat success
        console.log('\n[Test] Chat success');
        const chatSuccess = await request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ message: "Hello Ghost" })
        });
        const chatSuccessData = JSON.parse(chatSuccess.data);
        if (!chatSuccessData.success || !chatSuccessData.text || (!chatSuccessData.text.includes('Mock response') && !chatSuccessData.text.includes('subtasks'))) {
            console.error('DEBUG: Chat Response =', chatSuccessData);
        }
        assert(chatSuccess.status === 200 && chatSuccessData.success, 'Chat returned success: true');
        assert(chatSuccessData.text && (chatSuccessData.text.includes('Mock response') || chatSuccessData.text.includes('subtasks')), 'Chat returned mocked LLM text');
        assert(chatSuccessData.runId, 'Chat response included runId');

        // 6. Second same-session chat while first is active (HTTP 409)
        console.log('\n[Test] Concurrent run rejection (409)');
        // Send a slow request
        const slowReq = request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ message: "mock_429_recover" }) // Takes 1s
        });
        await sleep(100);
        // Send overlapping request
        const overlapReq = await request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ message: "Overlap" })
        });
        assert(overlapReq.status === 409, `Overlapping request rejected with HTTP 409 (got ${overlapReq.status})`);
        
        // Wait for slowReq to finish to clear the run state
        await slowReq;

        // 7. Cancel active run
        console.log('\n[Test] Cancel active run');
        // We need a slow request to cancel. We will initiate a mock_429_recover.
        const cancelReqPromise = request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ message: "mock_429_recover" })
        });
        await sleep(100);
        const cancelViaChat = await request('/api/runs/cancel-active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie }
        });
        assert(cancelViaChat.status === 200, 'Cancel command accepted');
        await cancelReqPromise; // Wait for the blocked request to finish its cleanup.

        // 8. Mock 429 with Retry-After (we tested the recovery above implicitly, but let's do it explicitly)
        console.log('\n[Test] Mock 429 Recovery');
        const recoverRes = await request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ message: "mock_429_recover" })
        });
        const recoverData = JSON.parse(recoverRes.data);
        assert(recoverData.success && recoverData.text.includes('Recovered'), 'LLM Router successfully backed off and recovered from 429');

        // 9. Permanent 429/route exhaustion
        console.log('\n[Test] Permanent 429 Exhaustion');
        const permRes = await request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ message: "mock_429_permanent" })
        });
        const permData = JSON.parse(permRes.data);
        if (permRes.status !== 200 || !permData.text || (!permData.text.includes('Matrix Interference') && !permData.text.includes('Too Many Requests'))) {
             console.error('DEBUG: Perm Exhaustion =', permRes.status, permData);
        }
        assert(permRes.status === 200 && permData.text && (permData.text.includes('Matrix Interference') || permData.text.includes('Too Many Requests')), 'Route exhaustion returned safe truthful error instead of crashing');

        // 10. Unapproved plan action
        console.log('\n[Test] Unapproved plan action');
        const planFail = await request('/api/execute-plan-step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
            body: JSON.stringify({ step: { description: 'test' }, goal: 'test', stepIndex: 0 })
        });
        const planFailData = JSON.parse(planFail.data);
        if (planFail.status !== 403 && planFailData.success !== false) {
             console.error('DEBUG: Plan Fail =', planFail.status, planFailData);
        }
        assert(planFail.status === 403 || planFailData.success === false, 'Direct plan step without valid state/approval was rejected');

    } catch (e) {
        console.error('❌ FATAL TEST ERROR:', e);
        allPassed = false;
    }

    return allPassed;
}

// Spawner logic
const serverProcess = spawn('node', ['server.js'], {
    env: { ...process.env, PORT, ADMIN_PASSPHRASE: 'test_password', MOCK_LLM: 'true' }
});

serverProcess.stdout.on('data', (data) => {
    // console.log(`[Server] ${data}`);
});
serverProcess.stderr.on('data', (data) => {
    // console.error(`[Server Error] ${data}`);
});

console.log(`Starting isolated test server on port ${PORT}...`);
setTimeout(async () => {
    try {
        const success = await runTests();
        serverProcess.kill();
        if (success) {
            console.log('\n🎉 ALL GHOST SMOKE TESTS PASSED!');
            serverProcess.kill('SIGKILL'); process.exit(0);
        } else {
            console.log('\n⚠️ SOME TESTS FAILED.');
            serverProcess.kill('SIGKILL'); process.exit(1);
        }
    } catch (error) {
        console.error('❌ Tests failed:', error);
        serverProcess.kill('SIGKILL'); process.exit(1);
    }
}, 3000);
