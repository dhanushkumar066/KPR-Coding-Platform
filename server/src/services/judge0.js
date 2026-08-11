import { env } from '../config/env.js';

/**
 * Judge0 client. Reached ONLY from the server — the frontend never talks to
 * Judge0 (non-negotiable #2), so its URL and token stay server-side.
 *
 * We deliberately do NOT send `expected_output`. Judge0 would then decide
 * Accepted/Wrong Answer using its own comparison; instead we ask it only to
 * *run* the code and we compare outputs ourselves with our normalization rules
 * (non-negotiable #3 — grading stays entirely under our control).
 */

const IN_QUEUE = 1;
const PROCESSING = 2;

export class Judge0Error extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'Judge0Error';
    this.cause = cause;
  }
}

function baseUrl() {
  if (env.judge0RapidApiKey) return `https://${env.judge0RapidApiHost}`;
  if (env.judge0Url) return env.judge0Url;
  throw new Judge0Error(
    'No Judge0 endpoint configured. Set JUDGE0_URL (self-hosted) or JUDGE0_RAPIDAPI_KEY.'
  );
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (env.judge0RapidApiKey) {
    h['X-RapidAPI-Key'] = env.judge0RapidApiKey;
    h['X-RapidAPI-Host'] = env.judge0RapidApiHost;
  } else if (env.judge0Token) {
    h['X-Auth-Token'] = env.judge0Token;
  }
  return h;
}

const b64 = (s) => Buffer.from(String(s ?? ''), 'utf8').toString('base64');
const unb64 = (s) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

async function judgeFetch(path, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Judge0Error(`Judge0 responded ${res.status}: ${body.slice(0, 300)}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Judge0Error) throw err;
    if (err.name === 'AbortError') throw new Judge0Error('Judge0 request timed out');
    throw new Judge0Error(`Cannot reach Judge0: ${err.message}`, err);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs one source file against many stdins in a single batch.
 * Uses asynchronous submission (wait=false) and polls, which is what keeps the
 * judge responsive when a whole class submits at once.
 *
 * @returns {Promise<Array<{stdout,stderr,compileOutput,statusId,statusDescription,timeMs,memoryKb}>>}
 */
export async function runBatch({ languageId, sourceCode, stdins, cpuTimeLimitSec, memoryLimitKb }) {
  if (!stdins.length) return [];

  const submissions = stdins.map((stdin) => ({
    language_id: languageId,
    source_code: b64(sourceCode),
    stdin: b64(stdin ?? ''),
    cpu_time_limit: cpuTimeLimitSec,
    // A hung process must not hold a judge worker for the full CPU budget.
    wall_time_limit: Math.min(cpuTimeLimitSec * 3 + 3, 30),
    memory_limit: memoryLimitKb,
    redirect_stderr_to_stdout: false,
  }));

  const created = await judgeFetch('/submissions/batch?base64_encoded=true', {
    method: 'POST',
    body: JSON.stringify({ submissions }),
  });

  const tokens = (created || []).map((c) => c.token).filter(Boolean);
  if (tokens.length !== stdins.length) {
    throw new Judge0Error('Judge0 accepted only part of the batch — refusing to grade partially');
  }

  const fields = 'stdout,stderr,compile_output,status,time,memory,token';
  const deadline = Date.now() + 90_000;
  let delay = 350;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 1.4, 2000);

    const { submissions: results } = await judgeFetch(
      `/submissions/batch?tokens=${tokens.join(',')}&base64_encoded=true&fields=${fields}`
    );

    const pending = results.some((r) => {
      const id = r?.status?.id;
      return id === IN_QUEUE || id === PROCESSING;
    });
    if (pending) continue;

    return results.map((r) => ({
      stdout: unb64(r.stdout),
      stderr: unb64(r.stderr),
      compileOutput: unb64(r.compile_output),
      statusId: r.status?.id ?? 0,
      statusDescription: r.status?.description || 'Unknown',
      timeMs: Math.round(Number(r.time || 0) * 1000),
      memoryKb: Number(r.memory || 0),
    }));
  }

  throw new Judge0Error('Judge0 did not finish grading in time');
}

export async function healthCheck() {
  try {
    const info = await judgeFetch('/about', {}, 6000);
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
