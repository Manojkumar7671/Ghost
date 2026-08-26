import assert from 'assert';
import { 
  validatePlan, 
  validateRelativePath, 
  validateCommand, 
  canonicalize, 
  hashPlan, 
  verifyPlanHash,
  PolicyViolationError
} from '../services/agentPolicy.js';

function runPhase1Tests() {
  console.log("--- PHASE 1 TESTS: agentPolicy.js ---");

  // 1. Path validation
  const validPaths = ['src/index.js', 'package.json', 'lib/utils/helper.js'];
  for (const p of validPaths) {
    assert.doesNotThrow(() => validateRelativePath(p), `Path should be valid: ${p}`);
  }

  const invalidPaths = [
    '/etc/passwd', // absolute
    'C:\\Windows', // absolute windows
    '../src/index.js', // traversal
    'src/../../index.js', // traversal
    '.env', // banned
    'config/.env.local', // banned pattern
    '.git/config', // banned
    '.ssh/id_rsa', // banned
    'credentials/secret.json', // banned
    'config/app.json', // banned
    'cert.pem', // banned
    '' // empty
  ];
  for (const p of invalidPaths) {
    assert.throws(() => validateRelativePath(p), PolicyViolationError, `Path should be invalid: ${p}`);
  }

  // 2. Command validation
  const validCommands = [
    { executable: 'npm', args: ['test'] },
    { executable: 'node', args: ['script.js'] }
  ];
  for (const cmd of validCommands) {
    assert.doesNotThrow(() => validateCommand(cmd), `Command should be valid: ${JSON.stringify(cmd)}`);
  }

  const invalidCommands = [
    { executable: 'sh', args: ['-c', 'rm -rf /'] }, // banned executable
    { executable: 'npm', args: ['test', '&&', 'echo', 'done'] }, // banned arg
    { executable: 'npm', args: ['test', ';', 'ls'] }, // banned arg
    { executable: 'npm', args: ['test', '||', 'echo'] }, // banned arg
    { executable: 'npm', args: ['test', '|', 'grep'] }, // banned arg
    { executable: 'npm', args: ['test', '$(whoami)'] }, // banned arg
    { executable: 'npm', args: ['test', '`whoami`'] }, // banned arg
    { executable: 'npm', args: ['test', '>', 'out.txt'] }, // banned arg
    { executable: 'python', args: ['script.py'] }, // banned executable
    { executable: 'npm' }, // missing args
    { executable: 'npm', args: "test" }, // args not array
    { executable: 'npm', args: ['test\nrm -rf /'] } // newline in arg
  ];
  for (const cmd of invalidCommands) {
    assert.throws(() => validateCommand(cmd), PolicyViolationError, `Command should be invalid: ${JSON.stringify(cmd)}`);
  }

  // 3. Plan validation
  const validPlan = {
    repoProfileId: 'test-repo-123',
    description: 'Fix the bug in the login form',
    route: 'mac',
    allowedPaths: ['src/login.js', 'src/auth.js'],
    testCommand: { executable: 'npm', args: ['test'] },
    deadline: Date.now() + 1000 * 60 * 60, // 1 hour from now
    maxRetries: 2,
    maxChangedFiles: 5
  };

  assert.doesNotThrow(() => validatePlan(validPlan), "Valid plan should pass");

  // Invalid route
  assert.throws(() => validatePlan({ ...validPlan, route: 'cloud' }), PolicyViolationError, "Invalid route should fail");

  // Unknown field
  assert.throws(() => validatePlan({ ...validPlan, maliciousField: 'true' }), PolicyViolationError, "Unknown field should fail");

  // Empty values
  assert.throws(() => validatePlan({ ...validPlan, description: '' }), PolicyViolationError, "Empty description should fail");
  assert.throws(() => validatePlan({ ...validPlan, allowedPaths: [] }), PolicyViolationError, "Empty allowed paths should fail");

  // Oversized/Nested
  assert.throws(() => validatePlan({ ...validPlan, nestedObj: { evil: true } }), PolicyViolationError, "Nested structures not allowed");

  // Invalid deadline
  assert.throws(() => validatePlan({ ...validPlan, deadline: Date.now() - 1000 }), PolicyViolationError, "Past deadline should fail");
  assert.throws(() => validatePlan({ ...validPlan, deadline: Date.now() + 1000 * 60 * 60 * 48 }), PolicyViolationError, "Deadline too far should fail");

  // 4. Hashing and Verification
  const hash1 = hashPlan(validPlan);
  const hash2 = hashPlan({ ...validPlan, maxRetries: 2 }); // identical
  assert.strictEqual(hash1, hash2, "Identical plans should produce identical hashes");

  // Verify plan hash
  assert.ok(verifyPlanHash(validPlan, hash1), "verifyPlanHash should return true for exact match");

  // Verification fails on alteration
  const tamperedPlan = { ...validPlan, maxRetries: 3 };
  assert.throws(() => verifyPlanHash(tamperedPlan, hash1), PolicyViolationError, "verifyPlanHash should fail for altered plan");

  console.log("✅ Phase 1 tests passed.");
}

try {
  runPhase1Tests();
} catch (err) {
  console.error("❌ Test failed:", err);
  process.exit(1);
}
