const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const { run } = require('../lib/run');

// A process is "alive" if signal 0 succeeds and it isn't a zombie.
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const stat = execSync(`ps -o stat= -p ${pid} || true`).toString().trim();
  return stat !== '' && !stat.startsWith('Z');
}

test('returns stdout and exit code 0 on success', async () => {
  const r = await run('echo hello');
  assert.strictEqual(r.output.trim(), 'hello');
  assert.strictEqual(r.exitCode, 0);
});

test('returns the non-zero exit code', async () => {
  const r = await run('exit 3');
  assert.strictEqual(r.exitCode, 3);
});

test('falls back to stderr when stdout is empty', async () => {
  const r = await run('echo oops >&2; exit 1');
  assert.strictEqual(r.output.trim(), 'oops');
  assert.strictEqual(r.exitCode, 1);
});

test('timeout kills the child the shell started, not just the shell', async () => {
  // `sleep` stands in for a hung `oc`. Print its PID first so we can check on it.
  const r = await run('sleep 300 & echo $!; wait', { timeout: 500 });
  const childPid = parseInt(r.output.trim().split('\n')[0], 10);
  assert.ok(childPid > 0, `expected a child pid, got output: ${JSON.stringify(r.output)}`);
  assert.notStrictEqual(r.exitCode, 0, 'a timed-out command must not report success');

  await new Promise((res) => setTimeout(res, 200));
  const leaked = alive(childPid);
  if (leaked) process.kill(childPid, 'SIGKILL'); // don't leave it behind if the test fails
  assert.strictEqual(leaked, false, `child ${childPid} survived the timeout`);
});
