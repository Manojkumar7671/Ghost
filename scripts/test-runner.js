import { spawn } from 'child_process';
import http from 'http';

const PORT = 4178;
const BASE_URL = `http://localhost:${PORT}`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth() {
    for (let i = 0; i < 30; i++) {
        try {
            const res = await new Promise((resolve, reject) => {
                http.get(`${BASE_URL}/health`, (res) => resolve(res)).on('error', reject);
            });
            if (res.statusCode === 200) {
                return true;
            }
        } catch (e) {
            // ignore
        }
        await sleep(500);
    }
    return false;
}

async function runTest(scriptPath) {
    return new Promise((resolve, reject) => {
        const testProc = spawn('node', [scriptPath], {
            env: { ...process.env, BASE_URL, PORT: PORT.toString(), MOCK_LLM: 'true' },
            stdio: 'inherit'
        });
        testProc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`${scriptPath} failed with code ${code}`));
        });
    });
}

(async () => {
    console.log(`Starting Ghost server on port ${PORT}...`);
    const serverProc = spawn('node', ['server.js'], {
        env: { ...process.env, PORT: PORT.toString(), MOCK_LLM: 'true', GHOST_DEPLOYMENT_MODE: 'public' },
        stdio: 'ignore'
    });

    try {
        const isHealthy = await waitForHealth();
        if (!isHealthy) {
            throw new Error('Server failed to start or health check timed out.');
        }
        console.log('Server is healthy. Running tests...');

        await runTest('tests/integration_stress_test.js');
        await runTest('tests/test_features.js');
        await runTest('tests/test_modes_daemon.js');
        await runTest('tests/test_full_suite.js');

        console.log('🎉 All integration tests passed!');
        serverProc.kill('SIGKILL'); process.exit(0);
    } catch (e) {
        console.error('❌ Test Runner Failed:', e.message);
        serverProc.kill('SIGKILL'); process.exit(1);
    } finally {
        serverProc.kill('SIGKILL');
    }
})();
