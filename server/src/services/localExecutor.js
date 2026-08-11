import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

/**
 * DEVELOPMENT-ONLY fallback executor.
 *
 * ⚠ This runs student-submitted code as a normal process on the host machine.
 * It applies a wall-clock timeout and an output cap, but it is NOT a sandbox:
 * there is no filesystem isolation, no memory cap and no syscall filtering.
 * Its only purpose is to let the platform be developed and demonstrated on a
 * machine without Docker. `assertProductionSafety()` refuses to boot the server
 * if this is still selected when NODE_ENV=production, and every entry point
 * below re-checks that guard.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(__dirname, '../../tmp');
const MAX_OUTPUT_BYTES = 256 * 1024;

// Mirrors Judge0's status ids so the rest of the app has one vocabulary.
const STATUS = {
  ACCEPTED: 3,
  TLE: 5,
  COMPILE_ERROR: 6,
  RUNTIME_ERROR: 11,
  INTERNAL_ERROR: 13,
};

function assertDevOnly() {
  if (env.isProd) {
    throw new Error('The local executor is disabled in production. Configure Judge0.');
  }
}

function resolveCmd(template, vars) {
  return template.map((part) =>
    part.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
  );
}

/**
 * DEV CONVENIENCE ONLY.
 *
 * Windows machines rarely have gcc/g++, but many have WSL, which does. When a
 * toolchain is missing natively we re-run the same command inside WSL so C and
 * C++ questions can still be exercised locally. Production uses Judge0 and
 * never reaches any of this.
 */
let wslChecked = false;
let wslUsable = false;

function hasWsl() {
  if (wslChecked) return wslUsable;
  wslChecked = true;
  try {
    const probe = spawnSync('wsl', ['-e', 'bash', '-lc', 'echo ok'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    wslUsable = probe.status === 0 && String(probe.stdout).includes('ok');
  } catch {
    wslUsable = false;
  }
  return wslUsable;
}

/** `E:\a\b` -> `/mnt/e/a/b` */
const toWslPath = (p) => `/mnt/${p[0].toLowerCase()}${p.slice(2).replace(/\\/g, '/')}`;

const looksLikeWindowsPath = (s) => /^[A-Za-z]:\\/.test(s);

/** Wraps a native command so it runs inside WSL, translating any paths. */
function asWslCommand(cmd, args) {
  const quoted = [cmd, ...args]
    .map((part) => (looksLikeWindowsPath(part) ? `'${toWslPath(part)}'` : `'${part}'`))
    .join(' ');
  return { cmd: 'wsl', args: ['-e', 'bash', '-lc', quoted] };
}

const nativeCache = new Map();

/** Is this executable on the host's PATH? */
function nativelyAvailable(cmd) {
  if (nativeCache.has(cmd)) return nativeCache.get(cmd);
  let found = false;
  try {
    const finder = os.platform() === 'win32' ? 'where' : 'which';
    found = spawnSync(finder, [cmd], { windowsHide: true, timeout: 8000 }).status === 0;
  } catch {
    found = false;
  }
  nativeCache.set(cmd, found);
  return found;
}

/**
 * Decides once, per language, whether this run goes through WSL: only on
 * Windows, only when the toolchain is genuinely missing natively, and only when
 * WSL actually answers.
 */
function shouldUseWsl(language) {
  if (os.platform() !== 'win32') return false;
  const first = (language.local.compile || language.local.run)[0];
  if (first.startsWith('{')) return false; // already a produced binary
  if (nativelyAvailable(first)) return false;
  return hasWsl();
}

function execute(rawCmd, rawArgs, { cwd, stdin = '', timeoutMs, useWsl = false }) {
  // Compile and run must agree: a binary produced by WSL's gcc is a Linux ELF
  // and cannot be launched by Windows, so the decision is made once per
  // language and applied to every step.
  const { cmd, args } = useWsl ? asWslCommand(rawCmd, rawArgs) : { cmd: rawCmd, args: rawArgs };

  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        // Windows resolves `python`/`javac` through shims that need shell:false
        // plus the .cmd/.exe extension; letting Node search PATH handles both.
        windowsHide: true,
      });
    } catch (err) {
      return resolve({ error: err, code: -1, stdout: '', stderr: String(err.message) });
    }

    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;
    let settled = false;

    const timer = setTimeout(() => {
      killedForTimeout = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
      else child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
    });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    child.on('error', (err) =>
      finish({ error: err, code: -1, stdout, stderr: stderr || err.message, killedForTimeout })
    );

    child.on('close', (code) => {
      const timeMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      finish({ code, stdout, stderr, killedForTimeout, timeMs });
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
    child.stdin.on('error', () => {
      /* the program exited before reading its input — not an error for us */
    });
  });
}

function missingToolResult(cmd, err) {
  const notFound = err?.code === 'ENOENT';
  return {
    stdout: '',
    stderr: '',
    compileOutput: notFound
      ? `The dev executor could not find "${cmd}" on this machine. Install it, or set EXECUTOR=judge0.`
      : String(err?.message || err),
    statusId: STATUS.INTERNAL_ERROR,
    statusDescription: notFound ? 'Language toolchain not installed' : 'Executor error',
    timeMs: 0,
    memoryKb: 0,
  };
}

/**
 * Same contract as judge0.runBatch — compile once, then run each stdin.
 */
export async function runBatch({ language, sourceCode, stdins, cpuTimeLimitSec }) {
  assertDevOnly();
  if (!stdins.length) return [];
  if (!language?.local) {
    return stdins.map(() => ({
      stdout: '',
      stderr: '',
      compileOutput: `${language?.label || 'This language'} is not available in the dev executor. Set EXECUTOR=judge0.`,
      statusId: STATUS.INTERNAL_ERROR,
      statusDescription: 'Language unsupported locally',
      timeMs: 0,
      memoryKb: 0,
    }));
  }

  await fs.mkdir(TMP_ROOT, { recursive: true });
  const dir = await fs.mkdtemp(path.join(TMP_ROOT, `run-${crypto.randomUUID().slice(0, 8)}-`));

  try {
    const fileName = language.fileName || `main.${language.ext}`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, sourceCode, 'utf8');

    const useWsl = shouldUseWsl(language);
    // A WSL build produces a Linux ELF, so drop the .exe suffix in that case.
    const binaryName = os.platform() === 'win32' && !useWsl ? 'program.exe' : 'program';
    const outPath = path.join(dir, binaryName);
    const vars = { file: filePath, out: outPath, dir };

    // ---- compile (only for compiled languages) ----
    if (language.local.compile) {
      const [cmd, ...args] = resolveCmd(language.local.compile, vars);
      const res = await execute(cmd, args, { cwd: dir, timeoutMs: 20000, useWsl });

      if (res.error) return stdins.map(() => missingToolResult(cmd, res.error));

      if (res.killedForTimeout || res.code !== 0) {
        const compileOutput = res.killedForTimeout
          ? 'Compilation timed out.'
          : `${res.stderr}${res.stdout}`.trim() || 'Compilation failed.';
        return stdins.map(() => ({
          stdout: '',
          stderr: '',
          compileOutput,
          statusId: STATUS.COMPILE_ERROR,
          statusDescription: 'Compilation Error',
          timeMs: 0,
          memoryKb: 0,
        }));
      }
    }

    // ---- run each case ----
    const [runCmd, ...runArgsTemplate] = resolveCmd(language.local.run, vars);
    const timeoutMs = Math.round(cpuTimeLimitSec * 1000) + 2000;

    const results = [];
    for (const stdin of stdins) {
      const res = await execute(runCmd, runArgsTemplate, {
        cwd: dir,
        stdin: stdin ?? '',
        timeoutMs,
        useWsl,
      });

      if (res.error) {
        results.push(missingToolResult(runCmd, res.error));
        continue;
      }

      let statusId = STATUS.ACCEPTED;
      let statusDescription = 'Executed';
      if (res.killedForTimeout) {
        statusId = STATUS.TLE;
        statusDescription = 'Time Limit Exceeded';
      } else if (res.code !== 0) {
        statusId = STATUS.RUNTIME_ERROR;
        statusDescription = `Runtime Error (exit ${res.code})`;
      }

      results.push({
        stdout: res.stdout,
        stderr: res.stderr,
        compileOutput: '',
        statusId,
        statusDescription,
        timeMs: res.timeMs || 0,
        // The dev executor cannot measure or cap memory; Judge0 does both.
        memoryKb: 0,
      });
    }
    return results;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function healthCheck() {
  return env.isProd
    ? { ok: false, error: 'local executor disabled in production' }
    : { ok: true, info: { note: 'dev executor — no sandbox' } };
}
