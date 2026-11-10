const { spawn } = require('child_process');

const DEFAULT_TIMEOUT = 30000;

// Runs cmd under bash and resolves { output, exitCode }; never rejects.
//
// The shell is started in its own process group so that a timeout kills
// everything it launched. child_process.exec() only signals the shell itself,
// which orphans the `oc` it was waiting on -- and with node as PID 1 nothing
// ever reaps those, so they pile up until the container runs out of memory.
function run(cmd, { timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-c', cmd], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // group already gone
      }
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ output: err.message, exitCode: 1 });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ output: stdout || stderr || `Command timed out after ${timeout}ms: ${cmd}`, exitCode: 1 });
        return;
      }
      resolve({ output: stdout || stderr || '', exitCode: code === null ? 1 : code });
    });
  });
}

module.exports = { run, DEFAULT_TIMEOUT };
