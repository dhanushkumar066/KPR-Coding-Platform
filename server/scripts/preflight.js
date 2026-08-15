/**
 * Is this deployment fit to run an exam?
 *
 *   npm run preflight
 *
 * Run it on the exam server, the morning of the paper, before students arrive.
 * Every check here corresponds to something that has actually gone wrong or
 * would go wrong silently — the failures that matter are the ones where the
 * application looks perfectly healthy and marks nobody correctly.
 *
 * FAIL means the exam will not work. WARN means it will work but something is
 * worth knowing. Nothing here changes any data.
 */
import mongoose from 'mongoose';
import os from 'node:os';
import fs from 'node:fs/promises';
import { env } from '../src/config/env.js';
import { UPLOAD_ROOT } from '../src/services/uploads.js';

const results = [];
const ok = (name, detail = '') => results.push({ level: 'ok', name, detail });
const warn = (name, detail) => results.push({ level: 'warn', name, detail });
const fail = (name, detail) => results.push({ level: 'fail', name, detail });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function checkConfig() {
  if (env.isProd) ok('NODE_ENV', 'production');
  else warn('NODE_ENV', `"${env.nodeEnv}" — the production safety checks are skipped unless this is "production"`);

  if (env.executor === 'judge0') {
    ok('Executor', 'judge0 (sandboxed)');
  } else {
    fail(
      'Executor',
      `"${env.executor}" runs student code on this machine with no sandbox. Set EXECUTOR=judge0.`
    );
  }

  if (env.allowDevLogin) {
    fail('Dev login', 'ALLOW_DEV_LOGIN is on — anyone can sign in as anyone. Set it to false.');
  } else ok('Dev login', 'disabled');

  const secret = process.env.JWT_SECRET || '';
  if (!secret || secret.length < 32) {
    fail('JWT_SECRET', `${secret.length} characters — needs at least 32 random ones, or sessions can be forged.`);
  } else if (/change-me|secret|password|example/i.test(secret)) {
    fail('JWT_SECRET', 'looks like the placeholder from .env.example. Generate a real one.');
  } else ok('JWT_SECRET', `${secret.length} characters`);

  const origin = process.env.CLIENT_ORIGIN || '';
  if (!origin) {
    fail('CLIENT_ORIGIN', 'not set — it is the address printed into every share link and QR code.');
  } else if (!/^https:\/\//.test(origin)) {
    fail(
      'CLIENT_ORIGIN',
      `"${origin}" is not https. The session cookie is Secure, so a plain-http origin cannot hold a login at all.`
    );
  } else ok('CLIENT_ORIGIN', origin);

  if (!env.googleClientId) {
    fail('Google sign-in', 'GOOGLE_CLIENT_ID is not set, and dev login is the only other way in.');
  } else ok('Google sign-in', 'client id set');

  if (env.allowedEmailDomain) ok('Email domain', `restricted to @${env.allowedEmailDomain}`);
  else warn('Email domain', 'ALLOWED_EMAIL_DOMAIN is blank — any Google account may sign in (the allowlist still gates each test).');
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

async function checkJudge() {
  if (env.executor !== 'judge0') return;

  const base = env.judge0Url;
  if (!base && !env.judge0RapidApiKey) {
    fail('Judge0', 'EXECUTOR is judge0 but neither JUDGE0_URL nor JUDGE0_RAPIDAPI_KEY is set.');
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (env.judge0Token) headers['X-Auth-Token'] = env.judge0Token;
  if (env.judge0RapidApiKey) {
    headers['X-RapidAPI-Key'] = env.judge0RapidApiKey;
    headers['X-RapidAPI-Host'] = env.judge0RapidApiHost;
  }
  const root = base || `https://${env.judge0RapidApiHost}`;

  try {
    const res = await fetch(`${root}/about`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      fail('Judge0 reachable', `${root} returned HTTP ${res.status}`);
      return;
    }
    const about = await res.json();
    ok('Judge0 reachable', `${root} — version ${about.version || 'unknown'}`);
  } catch (err) {
    fail('Judge0 reachable', `${root} — ${err.message}`);
    return;
  }

  /*
   * The check that matters.
   *
   * A Judge0 whose API answers but whose sandbox cannot start returns
   * "Internal Error" for every submission. Nothing about that is visible from
   * /about, the server looks healthy, and a whole paper marks as zero. So
   * actually run code and check the answer.
   */
  try {
    const res = await fetch(`${root}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ language_id: 71, source_code: 'print(2+3)' }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await res.json();

    if (String(body.stdout || '').trim() === '5') {
      ok('Judge0 sandbox executes', `python ran in ${body.time || '?'}s`);
    } else {
      fail(
        'Judge0 sandbox executes',
        `expected "5", got status "${body.status?.description}" ${body.message ? `— ${body.message}` : ''}. ` +
          'Every submission will fail this way. Usually the sandbox cannot create its control group (cgroup v1 required).'
      );
    }
  } catch (err) {
    fail('Judge0 sandbox executes', err.message);
  }

  /*
   * Is the judge reachable from outside this machine?
   *
   * Judge0's shipped compose publishes 2358 on 0.0.0.0. That puts a service
   * whose entire purpose is executing arbitrary code onto the network, with no
   * login and no allowlist in front of it — a far bigger hole than anything the
   * exam itself could leak. The fix is a one-line change to the ports mapping
   * (see DEPLOYMENT.md §3), so it is worth checking rather than trusting.
   */
  if (base && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(base)) {
    try {
      const { execSync } = await import('node:child_process');
      const out = execSync('ss -tln 2>/dev/null || netstat -an 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
      });
      const line = out.split('\n').find((l) => /[:.]2358\b/.test(l) && /LISTEN/i.test(l));
      if (line && /0\.0\.0\.0:2358|\*:2358|\[::\]:2358/.test(line)) {
        fail(
          'Judge0 not exposed',
          'listening on 0.0.0.0:2358 — anyone who can reach this machine can execute arbitrary code. Bind it to 127.0.0.1 (DEPLOYMENT.md §3).'
        );
      } else if (line) {
        ok('Judge0 not exposed', 'bound to localhost only');
      } else {
        warn('Judge0 not exposed', 'could not read the listening socket — check `ss -tln | grep 2358` by hand.');
      }
    } catch {
      warn('Judge0 not exposed', 'could not check automatically — run `ss -tln | grep 2358` and confirm it says 127.0.0.1.');
    }
  }
}

// ---------------------------------------------------------------------------
// Database and people
// ---------------------------------------------------------------------------

async function checkDatabase() {
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
    ok('MongoDB', mongoose.connection.name);
  } catch (err) {
    fail('MongoDB', `${env.mongoUri} — ${err.message}`);
    return false;
  }

  const { User } = await import('../src/models/User.js');
  const { Submission } = await import('../src/models/Submission.js');

  const admins = await User.countDocuments({ role: 'admin' });
  if (!admins) {
    fail(
      'Administrators',
      'no admin account exists. Put a college address in ADMIN_EMAILS and have them sign in, or nobody can appoint any staff.'
    );
  } else {
    const unassigned = await User.countDocuments({ role: 'admin', department: '' });
    ok('Administrators', `${admins} head${admins === 1 ? '' : 's'} of department`);
    if (unassigned) {
      warn('Departments', `${unassigned} head(s) have not named a department yet — they are scoped to nothing until they do.`);
    }
  }

  const teachers = await User.countDocuments({ role: 'teacher' });
  if (!teachers) warn('Teachers', 'none yet — heads add them by email from the staff screen.');
  else ok('Teachers', String(teachers));

  // A backlog left over from a previous run would start grading the moment the
  // server boots, competing with the exam about to begin.
  const pending = await Submission.countDocuments({ status: 'pending' });
  if (pending > 100) warn('Grading backlog', `${pending} submissions still pending from an earlier run.`);
  else ok('Grading backlog', String(pending));

  return true;
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

async function checkMachine() {
  const cores = os.cpus().length;
  const configured = Number(process.env.WEB_CONCURRENCY || 0);
  const workers = configured > 0 ? configured : Math.max(1, Math.min(cores - 1, 16));
  if (workers === 1 && cores > 2) {
    warn(
      'Workers',
      `1 worker on ${cores} cores. Node uses one core per process; measured at 2000 students a single worker refused thousands of connections. Unset WEB_CONCURRENCY or raise it.`
    );
  } else ok('Workers', `${workers} on ${cores} cores`);

  const gb = os.totalmem() / 1024 ** 3;
  if (gb < 3.5) warn('Memory', `${gb.toFixed(1)} GB total — thin for a full hall plus MongoDB.`);
  else ok('Memory', `${gb.toFixed(1)} GB`);

  try {
    await fs.mkdir(UPLOAD_ROOT, { recursive: true });
    const probe = `${UPLOAD_ROOT}/.preflight`;
    await fs.writeFile(probe, 'x');
    await fs.unlink(probe);
    ok('Uploads writable', UPLOAD_ROOT);
  } catch (err) {
    fail('Uploads writable', `${UPLOAD_ROOT} — ${err.message}. Question images would fail to save.`);
  }

  // Exam deadlines are computed from this clock. A server running slow gives
  // some students extra time and cuts others short, and nothing in the app can
  // detect it.
  const skewMs = Math.abs(Date.now() - new Date().getTime());
  ok('Clock', `${new Date().toISOString()} (verify NTP is running — every deadline depends on it)`);
  void skewMs;
}

// ---------------------------------------------------------------------------

async function main() {
  checkConfig();
  await checkJudge();
  const dbUp = await checkDatabase();
  await checkMachine();

  const pad = (s) => s.padEnd(26);
  console.log('\n  Preflight — is this deployment fit to run an exam?\n');
  for (const r of results) {
    const mark = r.level === 'ok' ? '  ok  ' : r.level === 'warn' ? ' WARN ' : ' FAIL ';
    console.log(`${mark} ${pad(r.name)} ${r.detail}`);
  }

  const fails = results.filter((r) => r.level === 'fail');
  const warns = results.filter((r) => r.level === 'warn');
  console.log('');
  if (fails.length) {
    console.log(`  ${fails.length} blocking problem(s). This deployment cannot run an exam yet.`);
  } else if (warns.length) {
    console.log(`  No blocking problems. ${warns.length} thing(s) worth reading above.`);
  } else {
    console.log('  Ready.');
  }
  console.log('');

  if (dbUp) await mongoose.disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('preflight itself failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
