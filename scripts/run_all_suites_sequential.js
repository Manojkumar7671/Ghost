import dotenv from 'dotenv';
dotenv.config({ override: true });
import { spawn, spawnSync } from 'child_process';
import http from 'http';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port = 3000) {
  for (let i = 0; i < 30; i++) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/health`, res => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
      });
      if (ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

function runCommandSync(cmd, args) {
  console.log(`\n>>> EXECUTING: ${cmd} ${args.join(' ')}\n`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`\n❌ Step failed with exit code ${result.status}: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

async function main() {
  console.log('================================================================');
  console.log('ONE SEQUENTIAL RUN OF ALL SUITES (PHASE 8A-FIX4)');
  console.log('1. Phase 8A Code Verification Test');
  console.log('2. Failover & Cooldown Test');
  console.log('3. Response Sanitizer Test');
  console.log('4. Verifier Consistency Unit Test');
  console.log('5. Ghost Smoke Test (Playwright on port 3000)');
  console.log('================================================================\n');

  // 1. Phase 8A code verification
  runCommandSync('node', ['tests/phase_8a_code_verification_test.js']);

  // 2. Failover test
  runCommandSync('node', ['tests/failover_test.js']);

  // 3. Response sanitizer test
  runCommandSync('node', ['tests/response_sanitizer.test.js']);

  // 4. Verifier consistency unit test
  runCommandSync('node', ['tests/verifier_consistency_unit_test.js']);

  // 5. Smoke test with live server on port 3000
  console.log('\n>>> STARTING GHOST SERVER ON PORT 3000 FOR SMOKE SUITE...\n');
  const serverProc = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3000' }
  });

  const healthy = await waitForServer(3000);
  if (!healthy) {
    serverProc.kill('SIGKILL');
    console.error('❌ Server failed to become healthy on port 3000');
    process.exit(1);
  }

  try {
    runCommandSync('npx', ['playwright', 'test', 'tests/smoke.spec.js']);
  } finally {
    console.log('\n>>> SHUTTING DOWN GHOST SERVER...');
    serverProc.kill('SIGTERM');
    await sleep(1000);
    serverProc.kill('SIGKILL');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL FIVE TEST SUITES PASSED IN ONE SEQUENTIAL RUN!');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Sequential suite execution failed:', err);
  process.exit(1);
});
