import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Test } from '../models/Test.js';
import { Question } from '../models/Question.js';
import { Attempt } from '../models/Attempt.js';
import { Submission } from '../models/Submission.js';

/**
 * Simulates a whole class hitting the API at once.
 *
 *   npm run loadtest -- --students 500
 *
 * Every student signs in, starts an attempt, autosaves, heartbeats and submits,
 * all concurrently. Measures what the API layer actually does under that load,
 * and watches the grading queue drain afterwards.
 *
 * Requires the dev server to be running. Creates its own throwaway test and
 * accounts, and deletes them at the end.
 */

const arg = (name, fallback) => {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (flag) return flag.split('=')[1];
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
};

// npm swallows `--students N` as its own config, so a bare number is accepted
// too: `npm run loadtest -- 500`.
const positional = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const STUDENTS = Number(arg('students', positional ?? 200));

// Seconds over which students arrive. 0 is the worst case — every socket in
// the same instant — which no real hall produces; `--ramp 30` models students
// clicking in over half a minute, which one does.
const RAMP_MS = Number(arg('ramp', 0)) * 1000;

// How hard a "browser" insists after a dropped connection. Matches the real
// client (see lib/api.js). Lowering it shows how much the retry is carrying;
// raising it shows whether refusals are transient or real saturation.
const RETRIES = Number(arg('retries', 5));

/** Transport-level failures, kept separately from HTTP errors. */
const transportErrors = [];
const BASE = arg('base', 'http://localhost:4000/api');
const TAG = `loadtest-${Date.now().toString(36)}`;

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

function summarise(label, times, errors) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  console.log(
    `  ${label.padEnd(22)} n=${String(times.length).padEnd(5)} ` +
      `mean=${Math.round(mean)}ms  p50=${Math.round(pct(sorted, 50))}ms  ` +
      `p95=${Math.round(pct(sorted, 95))}ms  max=${Math.round(sorted.at(-1) || 0)}ms` +
      (errors ? `  errors=${errors}` : '')
  );
}

/** One student's whole session, as the browser would drive it. */
async function student(index, testId, timings) {
  const email = `${TAG}-s${index}@college.edu`;
  let cookie = '';

  const call = async (method, path, body) => {
    const started = Date.now();

    // Retry a dropped connection. 500 sockets opening in the same instant will
    // always produce a few resets; a real browser retries, so the harness must
    // too or it ends up measuring its own socket pool instead of the server.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const text = await res.text();
        return {
          status: res.status,
          ms: Date.now() - started,
          body: text ? JSON.parse(text) : null,
        };
      } catch (err) {
        transportErrors.push(`${path}: ${err.cause?.code || err.message}`);
        if (attempt + 1 >= RETRIES) throw err;
        // Jittered, so retries spread out instead of arriving as a second burst.
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.random() * 500));
      }
    }
  };

  const record = (bucket, r, ok = (x) => x.status < 400) => {
    timings[bucket].times.push(r.ms);
    if (!ok(r)) {
      timings[bucket].errors += 1;
      if (timings[bucket].sample === null) timings[bucket].sample = `${r.status} ${r.body?.error}`;
    }
    return r;
  };

  record('signIn', await call('POST', '/auth/dev-login', { email }));
  record('profile', await call('PATCH', '/auth/profile', { name: `Load ${index}`, rollNumber: `LT${index}` }));

  const start = record('startAttempt', await call('POST', `/exam/tests/${testId}/start`, {
    sessionId: `lt-${index}`,
  }));
  const question = start.body?.questions?.[0];
  if (!question) return;

  record('autosave', await call('POST', `/exam/tests/${testId}/autosave`, {
    questionId: question.id,
    language: 'python',
    code: 'class Solution:\n    def sum(self, a, b):\n        return a + b\n',
  }));

  record('heartbeat', await call('POST', `/exam/tests/${testId}/heartbeat`, { sessionId: `lt-${index}` }));

  const submit = record(
    'submit',
    await call('POST', `/exam/tests/${testId}/submit`, {
      questionId: question.id,
      language: 'python',
      code: 'class Solution:\n    def sum(self, a: int, b: int) -> int:\n        return a + b\n',
      // Same token across this student's retries, exactly as the browser does,
      // so a resent submission must not become a second submission.
      clientToken: `lt-${TAG}-${index}`,
    }),
    (x) => x.status === 202
  );

  return submit.body?.submissionId;
}

async function main() {
  await connectDb();

  // ---- fixtures ----
  const teacher = await User.findOne({ email: 'teacher@college.edu' });
  if (!teacher) throw new Error('Run `npm run seed` first');
  const question = await Question.findOne({ title: 'Sum of Two Numbers', createdBy: teacher._id });
  if (!question) throw new Error('Seeded question missing — run `npm run seed`');

  // An aborted earlier run leaves pending submissions behind, and the server
  // dutifully re-queues them on its next boot — which would show up here as
  // this run's queue being twice as deep as the students it created.
  const orphans = await Test.find({ title: /^Load test loadtest-/ }).select('_id');
  if (orphans.length) {
    const ids = orphans.map((t) => t._id);
    const [subs, users] = await Promise.all([
      Submission.countDocuments({ test: { $in: ids } }),
      User.find({ email: /^loadtest-/ }).select('_id'),
    ]);
    console.log(`\n  clearing ${orphans.length} test(s) and ${subs} submission(s) from an aborted run`);
    await Submission.deleteMany({ test: { $in: ids } });
    await Attempt.deleteMany({ test: { $in: ids } });
    await User.deleteMany({ _id: { $in: users.map((u) => u._id) } });
    await Test.deleteMany({ _id: { $in: ids } });
  }

  const now = Date.now();
  const test = await Test.create({
    title: `Load test ${TAG}`,
    startAt: new Date(now - 60_000),
    endAt: new Date(now + 3 * 3600_000),
    durationMinutes: 120,
    allowedLanguages: ['python'],
    questions: [question._id],
    allowlist: Array.from({ length: STUDENTS }, (_, i) => `${TAG}-s${i}@college.edu`),
    status: 'published',
    createdBy: teacher._id,
  });

  console.log(
    `\n  ${STUDENTS} students, question "${question.title}", test ${test._id}` +
      (RAMP_MS ? `, arriving over ${RAMP_MS / 1000}s` : ', all at once') +
      '\n'
  );

  const timings = {};
  for (const k of ['signIn', 'profile', 'startAttempt', 'autosave', 'heartbeat', 'submit']) {
    timings[k] = { times: [], errors: 0, sample: null };
  }

  // ---- the rush ----
  const wallStart = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: STUDENTS }, async (_, i) => {
      if (RAMP_MS) await new Promise((r) => setTimeout(r, Math.random() * RAMP_MS));
      return student(i, test._id, timings);
    })
  );
  const wallMs = Date.now() - wallStart;

  const crashed = results.filter((r) => r.status === 'rejected');
  console.log(`  All ${STUDENTS} sessions issued in ${wallMs} ms\n`);

  for (const [label, t] of Object.entries(timings)) summarise(label, t.times, t.errors);
  for (const [label, t] of Object.entries(timings)) {
    if (t.sample) console.log(`    first ${label} error: ${t.sample}`);
  }
  if (crashed.length) console.log(`  ${crashed.length} session(s) gave up: ${crashed[0].reason?.message}`);

  if (transportErrors.length) {
    const byCode = transportErrors.reduce((acc, e) => {
      const code = e.split(': ').pop();
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});
    console.log(
      `  ${transportErrors.length} transport retr${transportErrors.length === 1 ? 'y' : 'ies'}: ` +
        Object.entries(byCode)
          .map(([c, n]) => `${c} x${n}`)
          .join(', ')
    );
  }

  // ---- watch the grading queue drain ----
  console.log('\n  draining the grading queue...');
  const drainStart = Date.now();
  let pending = 0;
  let lastLog = 0;

  for (;;) {
    pending = await Submission.countDocuments({ test: test._id, status: 'pending' });
    const elapsed = Date.now() - drainStart;
    if (pending === 0 || elapsed > 15 * 60_000) break;
    if (elapsed - lastLog > 5000) {
      lastLog = elapsed;
      const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
      console.log(
        `    ${Math.round(elapsed / 1000)}s  pending=${pending}` +
          (health ? `  active=${health.execution.active} queued=${health.execution.queued}` : '')
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const drainMs = Date.now() - drainStart;
  const graded = await Submission.countDocuments({ test: test._id, status: 'graded' });
  const errored = await Submission.countDocuments({ test: test._id, status: 'error' });
  const accepted = await Submission.countDocuments({ test: test._id, verdict: 'Accepted' });

  console.log(
    `\n  graded ${graded}, errored ${errored}, still pending ${pending} in ${Math.round(drainMs / 1000)}s` +
      `  (${(graded / Math.max(drainMs / 1000, 0.001)).toFixed(1)}/s)`
  );
  console.log(`  correct verdicts: ${accepted}/${STUDENTS}`);

  // A retried submission must not have become a second submission. Any student
  // with more than one row here means a network hiccup duplicated an answer.
  const dupes = await Submission.aggregate([
    { $match: { test: test._id, kind: 'submit' } },
    { $group: { _id: '$student', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'students' },
  ]);
  console.log(`  duplicate submissions from retries: ${dupes[0]?.students ?? 0}`);

  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (health) {
    console.log(
      `  peak concurrent executions: ${health.execution.peakActive} (limit ${health.execution.max}), ` +
        `peak queue depth: ${health.execution.peakQueued}`
    );
  }

  // ---- cleanup ----
  const users = await User.find({ email: new RegExp(`^${TAG}-`) }).select('_id');
  const ids = users.map((u) => u._id);
  await Submission.deleteMany({ test: test._id });
  await Attempt.deleteMany({ test: test._id });
  await User.deleteMany({ _id: { $in: ids } });
  await test.deleteOne();
  console.log(`\n  cleaned up ${ids.length} accounts and the throwaway test\n`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[loadtest] failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
