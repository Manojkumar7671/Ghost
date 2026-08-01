import { spawnSync, execSync } from 'child_process';

/**
 * Runs an optional pre-execution reasoning step using Claude Code CLI.
 * Toggleable via CLAUDE_PRESTEP_ENABLED=true.
 */
export function runClaudeReasoningPrestep(userPrompt = '') {
  const isEnabled = process.env.CLAUDE_PRESTEP_ENABLED === 'true';
  if (!isEnabled) {
    return { enabled: false, reasoning: null, reason: 'CLAUDE_PRESTEP_ENABLED is not set to true' };
  }

  try {
    execSync('which claude', { stdio: 'pipe' });
  } catch (err) {
    console.warn('[Claude Pre-Step] Claude CLI ("claude") not found on PATH.');
    return { enabled: true, reasoning: null, reason: 'Claude CLI ("claude") not installed or not on PATH' };
  }

  try {
    console.log('[Claude Pre-Step] Invoking Claude Code CLI via spawnSync...');
    const promptText = `Provide a brief 2-sentence tactical reasoning breakdown for: ${userPrompt}`;
    
    const result = spawnSync('claude', [
      '-p', promptText,
      '--output-format', 'text'
    ], {
      timeout: 15000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    if (result.error) {
      console.warn('[Claude Pre-Step Error]:', result.error.message);
      return { enabled: true, reasoning: null, reason: result.error.message };
    }

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();

    if (result.status !== 0) {
      const errDetail = stderr || stdout || `Exit code ${result.status}`;
      console.warn('[Claude Pre-Step Non-Zero Exit]:', errDetail);
      return { enabled: true, reasoning: null, reason: errDetail };
    }

    console.log('[Claude Pre-Step Output]:', stdout.slice(0, 150));
    return { enabled: true, reasoning: stdout, reason: null };
  } catch (err) {
    console.warn('[Claude Pre-Step Failed]:', err.message);
    return { enabled: true, reasoning: null, reason: err.message };
  }
}

export default { runClaudeReasoningPrestep };
