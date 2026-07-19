import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * Execute Python code in an isolated OS-level sandbox with strict resource limits.
 * Returns a promise resolving to { success: boolean, output: string, error: string }
 *
 * @param {string} code - The python code to execute.
 */
export async function runPythonSandbox(code) {
  if (!code || typeof code !== 'string') {
    return { success: false, output: '', error: 'Empty code' };
  }

  // Create an isolated temp directory for this execution
  const tempDirName = `ghost_sandbox_${crypto.randomUUID()}`;
  const tempDirPath = path.join(os.tmpdir(), tempDirName);
  fs.mkdirSync(tempDirPath, { recursive: true });

  const userCodePath = path.join(tempDirPath, 'user_code.py');
  const wrapperPath = path.join(tempDirPath, 'wrapper.py');

  // Write user's code to a temp file
  fs.writeFileSync(userCodePath, code, 'utf-8');

  // Write wrapper script to set resource limits before running user code
  const wrapperContent = `import resource
import sys
import runpy

# Resource limits to apply before running user code
# RLIMIT_CPU: 5 seconds CPU time
# RLIMIT_AS: 256MB memory limit (address space)
# RLIMIT_NPROC: 1 process limit (prevents fork/subprocess creation)
# RLIMIT_FSIZE: 1MB write limit (maximum file size created)
limits = [
    (resource.RLIMIT_CPU, (5, 5)),
    (resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024)),
    (resource.RLIMIT_NPROC, (1, 1)),
    (resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
]

for limit_type, limit_val in limits:
    try:
        resource.setrlimit(limit_type, limit_val)
    except (ValueError, OSError) as e:
        # Gracefully handle limits unsupported by the host kernel (e.g. RLIMIT_AS on macOS)
        pass

try:
    runpy.run_path('user_code.py', run_name='__main__')
except Exception as e:
    # Let standard exception handling print the stack trace to stderr
    raise
`;
  fs.writeFileSync(wrapperPath, wrapperContent, 'utf-8');

  // Set up clean environment (only PATH passed, stripping secrets/API keys)
  const cleanEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin'
  };

  // Hard wall-clock timeout of 10 seconds via AbortSignal.timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10000);

  // Set spawn options
  // detached: true makes the child process the leader of a new process group,
  // allowing us to SIGKILL the entire process group on timeout.
  const spawnOptions = {
    cwd: tempDirPath,
    env: cleanEnv,
    detached: true,
    signal: controller.signal
  };

  return new Promise((resolve) => {
    const child = spawn('python3', [wrapperPath], spawnOptions);

    let stdoutData = '';
    let stderrData = '';
    let terminated = false;
    let limitExceeded = false;
    const maxBuffer = 1024 * 1024; // 1MB output limit

    // Safely kills the child process group (negative PID)
    const killProcessGroup = (sig = 'SIGKILL') => {
      if (child.pid && child.pid > 0) {
        try {
          process.kill(-child.pid, sig);
        } catch (e) {
          // Ignore if process group is already dead
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      if (stdoutData.length > maxBuffer) {
        limitExceeded = true;
        killProcessGroup();
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
      if (stderrData.length > maxBuffer) {
        limitExceeded = true;
        killProcessGroup();
      }
    });

    controller.signal.addEventListener('abort', () => {
      terminated = true;
      killProcessGroup();
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      cleanupTempDir();

      if (err.name === 'AbortError' || terminated) {
        resolve({
          success: false,
          output: stdoutData,
          error: 'Execution timed out (10s wall-clock limit exceeded)'
        });
      } else {
        resolve({
          success: false,
          output: stdoutData,
          error: `Failed to start Python process: ${err.message}`
        });
      }
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeoutId);
      cleanupTempDir();

      if (limitExceeded) {
        resolve({
          success: false,
          output: stdoutData.substring(0, maxBuffer),
          error: 'Execution blocked: output buffer limit (1MB) exceeded.'
        });
        return;
      }

      if (signal) {
        let errorMsg = `Process terminated with signal ${signal}`;
        if (signal === 'SIGXCPU') {
          errorMsg = 'CPU time limit exceeded (5s CPU limit)';
        } else if (signal === 'SIGXFSZ') {
          errorMsg = 'File size limit exceeded (1MB write limit)';
        } else if (signal === 'SIGKILL' && terminated) {
          errorMsg = 'Execution timed out (10s wall-clock limit exceeded)';
        }
        resolve({
          success: false,
          output: stdoutData,
          error: errorMsg
        });
      } else if (code !== 0) {
        resolve({
          success: false,
          output: stdoutData,
          error: stderrData.trim() || `Process exited with code ${code}`
        });
      } else {
        resolve({
          success: true,
          output: stdoutData,
          error: ''
        });
      }
    });

    function cleanupTempDir() {
      try {
        if (fs.existsSync(tempDirPath)) {
          fs.rmSync(tempDirPath, { recursive: true, force: true });
        }
      } catch (err) {
        console.error(`Failed to cleanup temp directory ${tempDirPath}:`, err.message);
      }
    }
  });
}
