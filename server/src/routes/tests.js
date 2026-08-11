import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { ownershipFilter, canReach } from '../services/scope.js';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { Test } from '../models/Test.js';
import { Question } from '../models/Question.js';
import { Attempt } from '../models/Attempt.js';
import { Submission } from '../models/Submission.js';
import { User } from '../models/User.js';
import { LANGUAGE_KEYS } from '../config/languages.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parseAllowlistFile, extractEmails } from '../services/allowlist.js';
import { SESSION_STALE_MS } from '../services/accessGate.js';
import { supportsFunctionMode, validateTestCases } from '../services/codegen/index.js';
import { evaluate } from '../services/grader.js';
import { describeAttempt, statsForAttempts, studentLabel } from '../services/attemptStats.js';
import { emitProctor } from '../services/realtime.js';

const router = express.Router();
router.use(requireAuth, requireRole('teacher', 'admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/**
 * The public origin students should be sent to.
 *
 * `CLIENT_ORIGIN` wins when it is set, because behind a reverse proxy the
 * request headers are the proxy's business and the deployer knows the real
 * address. When it is *not* set we fall back to the address this request
 * actually arrived on rather than to the localhost default — a teacher who
 * printed a QR pointing at `http://localhost:5173` would not discover the
 * mistake until a hall full of students had already scanned it.
 *
 * @returns {{origin: string, derived: boolean}} `derived` is true when the
 *   value came from the request, so the UI can say so.
 */
function shareOrigin(req) {
  if (process.env.CLIENT_ORIGIN) {
    return { origin: env.clientOrigin.replace(/\/+$/, ''), derived: false };
  }

  // Express populates these from X-Forwarded-* only when `trust proxy` is on,
  // which app.js sets in production.
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return { origin: env.clientOrigin.replace(/\/+$/, ''), derived: true };

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return { origin: `${proto}://${host}`.replace(/\/+$/, ''), derived: true };
}

// The raw field shape. Kept un-refined so it can still be `.partial()`d —
// `.refine()` returns a ZodEffects, which has no `.partial()`.
const testFields = z
  .object({
    title: z.string().trim().min(1, 'A title is required'),
    description: z.string().default(''),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    durationMinutes: z.number().int().min(1).max(1440),
    allowedLanguages: z.array(z.enum(LANGUAGE_KEYS)).min(1, 'Allow at least one language'),
    questions: z.array(z.string()).default([]),
    questionsPerStudent: z.number().int().min(0).default(0),
    randomizeOrder: z.boolean().default(false),
    warningLimit: z.number().int().min(1).max(20).default(3),
    graceMs: z.number().int().min(0).max(15000).default(2500),
    fullscreenGraceSec: z.number().int().min(0).max(300).default(15),
    isPractice: z.boolean().default(false),
  });

const WINDOW_ORDER = {
  message: 'The end time must be after the start time',
  path: ['endAt'],
};

const createTestSchema = testFields.refine((d) => d.endAt > d.startAt, WINDOW_ORDER);

// On an update either bound may be absent, so only compare when both are sent.
const updateTestSchema = testFields
  .partial()
  .refine((d) => !d.startAt || !d.endAt || d.endAt > d.startAt, WINDOW_ORDER);

async function loadOwned(id, user, { populate = false } = {}) {
  const query = Test.findById(id);
  if (populate) query.populate('questions');
  const test = await query;
  if (!test) throw new ApiError(404, 'Test not found');
  if (!(await canReach(user, test.createdBy))) {
    throw new ApiError(403, 'This test belongs to another teacher');
  }
  return test;
}

// Department-scoped: see services/scope.js. An HOD sees their department's
// tests, not the whole college's.

/** Verifies every referenced question exists and belongs to this teacher. */
async function assertQuestionsOwned(ids, user) {
  if (!ids.length) return;
  const filter = { _id: { $in: ids }, ...(await ownershipFilter(user)) };
  const found = await Question.countDocuments(filter);
  if (found !== new Set(ids.map(String)).size) {
    throw new ApiError(400, 'One or more questions do not exist or are not yours');
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tests = await Test.find(await ownershipFilter(req.user))
      .sort({ createdAt: -1 })
      .limit(200);

    const counts = await Attempt.aggregate([
      { $match: { test: { $in: tests.map((t) => t._id) } } },
      {
        $group: {
          _id: '$test',
          started: { $sum: 1 },
          finished: {
            $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 0, 1] },
          },
        },
      },
    ]);
    const countById = new Map(counts.map((c) => [c._id.toString(), c]));

    res.json({
      tests: tests.map((t) => ({
        id: t._id,
        title: t.title,
        status: t.status,
        isPractice: t.isPractice,
        startAt: t.startAt,
        endAt: t.endAt,
        durationMinutes: t.durationMinutes,
        questionCount: t.questions.length,
        allowlistCount: t.allowlist.length,
        paused: t.paused,
        started: countById.get(t._id.toString())?.started || 0,
        finished: countById.get(t._id.toString())?.finished || 0,
      })),
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createTestSchema.parse(req.body);
    await assertQuestionsOwned(data.questions, req.user);
    const test = await Test.create({ ...data, createdBy: req.user._id });
    res.status(201).json({ test });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user, { populate: true });

    /*
     * Publishing checks that every coding question is answerable, but a test
     * already published can still go bad: editing a case clears that question's
     * verification without un-publishing anything. So the check is reported on
     * every read, not only at the moment of publishing.
     */
    const questions = test.questions.map((q) => ({
      id: q._id,
      title: q.title,
      difficulty: q.difficulty,
      marks: q.marks,
      caseCount: q.testCases.length,
      kind: q.kind,
      // Needed to rebuild a GATE paper when a teacher reopens the draft —
      // without these the sections collapse and every MSQ reads as an MCQ.
      style: q.style,
      section: q.section,
      multiSelect: Boolean(q.mcq?.multiSelect),
      check: typeof q.verificationState === 'function' ? q.verificationState() : 'passed',
      caseProblems: typeof q.verificationState === 'function' ? validateTestCases(q) : [],
    }));

    // Only coding questions have test cases to be wrong about. NAT arrived
    // after this line was written and would otherwise be checked for test cases
    // it is never meant to have.
    const coding = questions.filter((q) => q.kind === 'coding');

    res.json({
      test: { ...test.toObject(), questions },
      // Split by severity so the UI can shout about one and merely mention the
      // other, rather than treating "not proven" as "broken".
      blocking: {
        malformed: coding.filter((q) => q.caseProblems.length).map((q) => q.title),
        failed: coding.filter((q) => q.check === 'failed').map((q) => q.title),
      },
      unchecked: coding.filter((q) => q.check === 'unchecked').map((q) => q.title),
    });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const data = updateTestSchema.parse(req.body);

    if (data.questions) await assertQuestionsOwned(data.questions, req.user);

    // Changing the schedule or the paper mid-exam would silently move students'
    // deadlines or swap questions under them. Compare against what is stored
    // rather than merely what was sent — the editor submits every field on save,
    // so a "did you send it?" check would block harmless edits like the title.
    const sameIds = (next, current) =>
      next.length === current.length &&
      next.every((id, i) => String(id) === String(current[i]));

    // <input type="datetime-local"> only expresses minutes, so a stored time
    // carrying seconds round-trips as "changed" unless both sides are truncated.
    const toMinute = (d) => Math.floor(d.getTime() / 60_000);

    const changed = [];
    if (data.durationMinutes !== undefined && data.durationMinutes !== test.durationMinutes) {
      changed.push('duration');
    }
    if (data.startAt !== undefined && toMinute(data.startAt) !== toMinute(test.startAt)) {
      changed.push('start time');
    }
    if (data.questions !== undefined && !sameIds(data.questions, test.questions)) {
      changed.push('questions');
    }
    if (
      data.questionsPerStudent !== undefined &&
      data.questionsPerStudent !== test.questionsPerStudent
    ) {
      changed.push('questions per student');
    }

    if (changed.length) {
      const liveAttempts = await Attempt.countDocuments({ test: test._id, status: 'in_progress' });
      if (liveAttempts > 0) {
        throw new ApiError(
          409,
          `${liveAttempts} student(s) are sitting this test right now, so the ${changed.join(', ')} cannot change — use pause or extend instead`
        );
      }
    }

    test.set(data);
    await test.save();
    res.json({ test });
  })
);

/**
 * Runs every coding question in this test against its own reference solution
 * and stamps the ones that pass.
 *
 * Publishing requires each question to be proven answerable; doing that one
 * question at a time across a twelve-question paper is tedious enough that a
 * teacher in a hurry would look for a way around it. This is that way.
 */
router.post(
  '/:id/verify-questions',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const questions = await Question.find({
      _id: { $in: test.questions },
      kind: { $ne: 'mcq' },
    });

    const results = [];
    for (const question of questions) {
      if (question.isVerified()) {
        results.push({ id: question._id, title: question.title, ok: true, note: 'already verified' });
        continue;
      }

      const { language, code } = question.referenceSolution || {};
      if (!language || !code?.trim()) {
        results.push({
          id: question._id,
          title: question.title,
          ok: false,
          note: 'no reference solution to check against',
        });
        continue;
      }

      try {
        const outcome = await evaluate({
          languageKey: language,
          code,
          cases: question.testCases,
          timeLimitSec: question.timeLimitSec,
          memoryLimitMb: question.memoryLimitMb,
          functionSpec: question.ioMode === 'function' ? question.functionSpec : null,
          classSpec: question.ioMode === 'class' ? question.classSpec : null,
          compare: question.answerCompare,
          marks: question.marks,
          scored: false,
        });

        const ok = outcome.totalCount > 0 && outcome.passedCount === outcome.totalCount;
        question.verification = {
          at: new Date(),
          ok,
          signature: question.answerabilitySignature(),
          note: ok
            ? `passed ${outcome.passedCount}/${outcome.totalCount}`
            : `${outcome.verdict} — ${outcome.passedCount}/${outcome.totalCount} passed`,
        };
        await question.save();

        results.push({
          id: question._id,
          title: question.title,
          ok,
          note: ok
            ? `passed ${outcome.passedCount}/${outcome.totalCount}`
            : `${outcome.verdict} — ${outcome.passedCount}/${outcome.totalCount} passed`,
        });
      } catch (err) {
        results.push({ id: question._id, title: question.title, ok: false, note: err.message });
      }
    }

    res.json({
      results,
      verified: results.filter((r) => r.ok).length,
      total: results.length,
    });
  })
);

router.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { status } = z.object({ status: z.enum(['draft', 'published']) }).parse(req.body);

    if (status === 'published') {
      if (!test.questions.length) throw new ApiError(400, 'Add at least one question first');
      if (!test.allowlist.length) throw new ApiError(400, 'Add the allowed students first');
      if (test.questionsPerStudent > test.questions.length) {
        throw new ApiError(400, 'Questions per student exceeds the size of the question pool');
      }

      // A function-signature question can only be generated for languages that
      // have a code generator, so catch the mismatch before students hit it.
      const functionQuestions = await Question.find({
        _id: { $in: test.questions },
        ioMode: 'function',
      }).select('title');

      if (functionQuestions.length) {
        const unsupported = test.allowedLanguages.filter((l) => !supportsFunctionMode(l));
        if (unsupported.length) {
          throw new ApiError(
            400,
            `"${functionQuestions[0].title}" uses a function signature, which ${unsupported.join(' and ')} cannot be generated for. Remove ${unsupported.length > 1 ? 'those languages' : 'that language'} from this test, or switch the question to standard input/output.`
          );
        }
      }

      /*
       * Two different things can be wrong with a question, and they deserve
       * very different treatment.
       *
       * Evidence it is broken blocks publishing: test data the harness cannot
       * read, or a reference solution that was run and did not pass. Both are
       * facts about the question, and both produce an error no student can do
       * anything about.
       *
       * Merely never having written a reference solution is *not* evidence of
       * anything. Demanding one for every question is a real tax on a teacher
       * setting a twelve-question paper, and a professional is entitled to
       * decide that "return a + b" needs no proof. That case warns instead.
       */
      const coding = await Question.find({
        _id: { $in: test.questions },
        kind: { $ne: 'mcq' },
      });

      const malformed = coding
        .map((q) => ({ q, problems: validateTestCases(q) }))
        .filter((x) => x.problems.length);

      if (malformed.length) {
        const { q, problems } = malformed[0];
        throw new ApiError(
          400,
          `"${q.title}" has test data the judge cannot read, so every student would hit an error. ${problems[0]}`,
          { question: q._id, problems }
        );
      }

      const failed = coding.filter((q) => q.failedVerification());
      if (failed.length) {
        const names = failed.map((q) => `"${q.title}"`).join(', ');
        throw new ApiError(
          400,
          `${names} did not pass ${failed.length === 1 ? 'its' : 'their'} own test cases when checked, so the expected outputs are wrong somewhere. Fix ${failed.length === 1 ? 'it' : 'them'} and re-run the check — publishing is blocked because this is known to be broken.`,
          { failed: failed.map((q) => ({ id: q._id, title: q.title })) }
        );
      }
    }

    test.status = status;
    await test.save();
    res.json({ test });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const attempts = await Attempt.countDocuments({ test: test._id });
    if (attempts > 0 && !req.query.force) {
      throw new ApiError(
        409,
        `${attempts} student attempt(s) exist for this test. Deleting it destroys their results — re-send with ?force=1 to confirm.`
      );
    }
    await Promise.all([
      Submission.deleteMany({ test: test._id }),
      Attempt.deleteMany({ test: test._id }),
      test.deleteOne(),
    ]);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Allowlist (§5)
// ---------------------------------------------------------------------------

router.post(
  '/:id/allowlist',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { text, emails, mode } = z
      .object({
        text: z.string().optional(),
        emails: z.array(z.string()).optional(),
        mode: z.enum(['append', 'replace']).default('append'),
      })
      .parse(req.body);

    const incoming = emails?.length ? extractEmails(emails.join('\n')) : extractEmails(text || '');
    if (!incoming.length) throw new ApiError(400, 'No valid email addresses found');

    const merged = mode === 'replace' ? incoming : [...new Set([...test.allowlist, ...incoming])];
    test.allowlist = merged;
    await test.save();

    res.json({ allowlist: test.allowlist, added: incoming.length, total: merged.length });
  })
);

router.post(
  '/:id/allowlist/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    if (!req.file) throw new ApiError(400, 'No file uploaded');

    let parsed;
    try {
      parsed = await parseAllowlistFile(req.file);
    } catch (err) {
      throw new ApiError(400, err.message);
    }
    if (!parsed.emails.length) {
      throw new ApiError(400, 'No email addresses found in that file');
    }

    const mode = req.body.mode === 'replace' ? 'replace' : 'append';
    test.allowlist =
      mode === 'replace' ? parsed.emails : [...new Set([...test.allowlist, ...parsed.emails])];
    await test.save();

    res.json({
      allowlist: test.allowlist,
      added: parsed.emails.length,
      total: test.allowlist.length,
      source: parsed.source,
    });
  })
);

router.delete(
  '/:id/allowlist/:email',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const email = decodeURIComponent(req.params.email).toLowerCase();
    test.allowlist = test.allowlist.filter((e) => e !== email);
    await test.save();
    res.json({ allowlist: test.allowlist });
  })
);

// ---------------------------------------------------------------------------
// Live changes
// ---------------------------------------------------------------------------

/**
 * Adds a question to a test that may already be running.
 *
 * The general settings save refuses to change the paper mid-exam for good
 * reason. This is the deliberate exception: an explicit, append-only action
 * that also hands the question to students who are already working, because a
 * question only some of the class can see would be worse than none at all.
 */
router.post(
  '/:id/questions',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { questionId } = z.object({ questionId: z.string() }).parse(req.body);

    await assertQuestionsOwned([questionId], req.user);
    if (test.questions.some((q) => q.toString() === questionId)) {
      throw new ApiError(409, 'That question is already in this test');
    }

    const question = await Question.findById(questionId);
    if (question.ioMode === 'function') {
      const unsupported = test.allowedLanguages.filter((l) => !supportsFunctionMode(l));
      if (unsupported.length) {
        throw new ApiError(
          400,
          `"${question.title}" uses a function signature, which ${unsupported.join(' and ')} cannot be generated for.`
        );
      }
    }

    test.questions.push(questionId);
    await test.save();

    // Sampled papers draw a random subset per student at start, so appending to
    // a live attempt would break that design — the pool grows for new starters
    // only, and we say so rather than silently doing nothing.
    const sampled = test.questionsPerStudent > 0;
    let updated = 0;

    if (!sampled) {
      const live = await Attempt.find({ test: test._id, status: 'in_progress' });
      await Promise.all(
        live.map((attempt) => {
          attempt.questionOrder.push(questionId);
          attempt.maxScore += question.marks;
          attempt.interventions.push({
            type: 'question_added',
            by: req.user._id,
            note: question.title,
            meta: { questionId },
          });
          return attempt.save();
        })
      );
      updated = live.length;
    }

    emitProctor(test._id, 'test:question-added', {
      questionId,
      title: question.title,
      reachedLiveStudents: updated,
    });

    res.json({
      questionCount: test.questions.length,
      liveAttemptsUpdated: updated,
      sampled,
      message: sampled
        ? 'Added to the question pool. Students already sitting this test keep the paper they were given.'
        : updated
          ? `Added, and handed to ${updated} student(s) currently sitting the test.`
          : 'Added to the test.',
    });
  })
);

/**
 * Lets a student back in after their attempt ended — a wrongly-terminated
 * student, or one who lost their machine. Their existing graded submissions
 * stand; the best score per question still wins.
 */
router.post(
  '/:id/attempts/:attemptId/reinstate',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { extraMinutes, resetWarnings, note } = z
      .object({
        extraMinutes: z.number().int().min(1).max(240).default(15),
        resetWarnings: z.boolean().default(true),
        note: z.string().max(300).default(''),
      })
      .parse(req.body || {});

    const attempt = await Attempt.findOne({ _id: req.params.attemptId, test: test._id });
    if (!attempt) throw new ApiError(404, 'Attempt not found');
    if (attempt.status === 'in_progress') {
      throw new ApiError(409, 'That student is still sitting the test');
    }

    const now = new Date();
    const deadline = new Date(now.getTime() + extraMinutes * 60_000);
    if (deadline > test.endAt) {
      throw new ApiError(
        409,
        `The test closes at ${test.endAt.toLocaleString()}, which is less than ${extraMinutes} minutes away. Extend the test window first.`
      );
    }

    attempt.status = 'in_progress';
    attempt.endsAt = deadline;
    attempt.submittedAt = undefined;
    attempt.terminatedReason = '';
    // A new session may claim the attempt immediately — the student is very
    // likely on a different machine by now.
    attempt.sessionId = '';
    attempt.lastHeartbeatAt = new Date(0);
    if (resetWarnings) attempt.warnings = 0;

    attempt.interventions.push({
      type: 'reinstated',
      by: req.user._id,
      note,
      meta: { extraMinutes, resetWarnings, previousStatus: attempt.status },
    });

    await attempt.save();

    emitProctor(test._id, 'attempt:reinstated', {
      attemptId: attempt._id,
      studentEmail: attempt.studentEmail,
      extraMinutes,
    });

    res.json({
      status: attempt.status,
      endsAt: attempt.endsAt,
      warnings: attempt.warnings,
      message: `${attempt.studentName || attempt.studentEmail} can sit the test again for ${extraMinutes} minutes.`,
    });
  })
);

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/**
 * A convenience link (and QR) the teacher can hand out.
 *
 * It is NOT an access token. Opening it still requires signing in with a
 * Google account that is on this test's allowlist, inside the scheduled window
 * (non-negotiable #6) — a leaked link grants nothing.
 */
router.get(
  '/:id/share',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { origin, derived } = shareOrigin(req);
    const url = `${origin}/exam/${test._id}`;

    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#171a2b', light: '#ffffff' },
    });

    res.json({
      url,
      qrDataUrl,
      // True when CLIENT_ORIGIN was not configured and we fell back to the
      // address this request arrived on. The teacher UI warns on it, because a
      // QR printed from a laptop on localhost is worthless in a hall.
      originDerived: derived,
      published: test.status === 'published',
      allowlistCount: test.allowlist.length,
      startAt: test.startAt,
      endAt: test.endAt,
    });
  })
);

// ---------------------------------------------------------------------------
// Live controls (§11 phase 7)
// ---------------------------------------------------------------------------

router.post(
  '/:id/pause',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);

    if (paused && !test.paused) {
      test.paused = true;
      test.pausedAt = new Date();
    } else if (!paused && test.paused) {
      // Give back exactly the time the pause consumed.
      const pausedMs = Date.now() - new Date(test.pausedAt || Date.now()).getTime();
      test.paused = false;
      test.pausedAt = undefined;
      if (pausedMs > 0) {
        // $inc does not apply to Date fields, so shift each deadline directly.
        const attempts = await Attempt.find({ test: test._id, status: 'in_progress' });
        await Promise.all(
          attempts.map((a) => {
            a.endsAt = new Date(a.endsAt.getTime() + pausedMs);
            return a.save();
          })
        );
        // The hard close has to move too, or the extra time is unusable.
        test.endAt = new Date(test.endAt.getTime() + pausedMs);
      }
    }

    await test.save();
    emitProctor(test._id, 'test:paused', { paused: test.paused });
    res.json({ paused: test.paused });
  })
);

router.post(
  '/:id/extend',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { minutes, alsoExtendWindow } = z
      .object({ minutes: z.number().int().min(1).max(240), alsoExtendWindow: z.boolean().default(true) })
      .parse(req.body);

    test.extensionMinutes = (test.extensionMinutes || 0) + minutes;
    // A personal deadline can never exceed the test's hard close, so the window
    // normally has to move too for the extension to be felt.
    if (alsoExtendWindow) test.endAt = new Date(test.endAt.getTime() + minutes * 60_000);
    await test.save();

    const attempts = await Attempt.find({ test: test._id, status: 'in_progress' });
    await Promise.all(
      attempts.map((a) => {
        const extended = new Date(a.endsAt.getTime() + minutes * 60_000);
        a.endsAt = extended < test.endAt ? extended : test.endAt;
        return a.save();
      })
    );

    emitProctor(test._id, 'test:extended', { minutes, endAt: test.endAt });
    res.json({ extensionMinutes: test.extensionMinutes, endAt: test.endAt, updated: attempts.length });
  })
);

// ---------------------------------------------------------------------------
// Live proctor dashboard (§6)
// ---------------------------------------------------------------------------

router.get(
  '/:id/proctor',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const attempts = await Attempt.find({ test: test._id })
      .populate('student', 'name email picture rollNumber')
      .sort({ startedAt: 1 });

    const stats = await statsForAttempts(attempts.map((a) => a._id));

    const now = Date.now();
    const rows = attempts.map((a) => ({
      attemptId: a._id,
      student: { id: a.student?._id, picture: a.student?.picture, ...studentLabel(a) },
      activity: describeAttempt(a, stats.get(a._id.toString())),
      status: a.status,
      connected:
        a.status === 'in_progress' &&
        now - new Date(a.lastHeartbeatAt || 0).getTime() < SESSION_STALE_MS,
      lastHeartbeatAt: a.lastHeartbeatAt,
      startedAt: a.startedAt,
      endsAt: a.endsAt,
      submittedAt: a.submittedAt,
      warnings: a.warnings,
      countedViolations: a.violations.filter((v) => v.counted).length,
      totalViolations: a.violations.length,
      score: a.status === 'in_progress' ? null : a.score,
      maxScore: a.maxScore,
      terminatedReason: a.terminatedReason,
      recentViolations: a.violations
        .slice(-5)
        .reverse()
        .map((v) => ({ type: v.type, at: v.at, counted: v.counted, reason: v.reason })),
    }));

    // Students on the allowlist who have not opened the test at all.
    const startedEmails = new Set(rows.map((r) => r.student.email));
    const notStarted = test.allowlist.filter((e) => !startedEmails.has(e));

    res.json({
      test: {
        id: test._id,
        title: test.title,
        paused: test.paused,
        startAt: test.startAt,
        endAt: test.endAt,
        warningLimit: test.warningLimit,
      },
      rows,
      notStarted,
      summary: {
        allowed: test.allowlist.length,
        started: rows.length,
        active: rows.filter((r) => r.status === 'in_progress').length,
        connected: rows.filter((r) => r.connected).length,
        submitted: rows.filter((r) => r.status === 'submitted' || r.status === 'auto_submitted')
          .length,
        terminated: rows.filter((r) => r.status === 'terminated').length,
        notStarted: notStarted.length,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// Submissions & results (§6)
// ---------------------------------------------------------------------------

router.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const filter = { test: test._id, kind: { $in: ['submit', 'auto'] } };
    if (req.query.questionId) filter.question = req.query.questionId;

    const submissions = await Submission.find(filter)
      .populate('student', 'name email rollNumber')
      .populate('question', 'title marks')
      .sort({ createdAt: -1 })
      .limit(1000);

    res.json({
      submissions: submissions.map((s) => ({
        id: s._id,
        student: { id: s.student?._id, name: s.student?.name, email: s.student?.email },
        question: { id: s.question?._id, title: s.question?.title },
        kind: s.kind,
        language: s.language,
        verdict: s.verdict,
        status: s.status,
        passedCount: s.passedCount,
        totalCount: s.totalCount,
        score: s.effectiveScore,
        maxScore: s.maxScore,
        overridden: typeof s.manualOverride?.score === 'number',
        pasteSignals: s.pasteSignals,
        createdAt: s.createdAt,
      })),
    });
  })
);

router.get(
  '/:id/attempts/:attemptId',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const attempt = await Attempt.findOne({ _id: req.params.attemptId, test: test._id })
      .populate('student', 'name email picture rollNumber')
      .populate('questionOrder', 'title marks');
    if (!attempt) throw new ApiError(404, 'Attempt not found');

    const attemptStats = await statsForAttempts([attempt._id]);

    const submissions = await Submission.find({
      attempt: attempt._id,
      kind: { $in: ['submit', 'auto'] },
    })
      .populate('question', 'title marks')
      .sort({ createdAt: -1 });

    res.json({
      attempt: {
        id: attempt._id,
        student: { id: attempt.student?._id, ...studentLabel(attempt) },
        activity: describeAttempt(attempt, attemptStats.get(attempt._id.toString())),
        status: attempt.status,
        startedAt: attempt.startedAt,
        endsAt: attempt.endsAt,
        submittedAt: attempt.submittedAt,
        warnings: attempt.warnings,
        terminatedReason: attempt.terminatedReason,
        score: attempt.score,
        maxScore: attempt.maxScore,
        questionOrder: attempt.questionOrder,
        violations: attempt.violations,
      },
      submissions: submissions.map((s) => ({
        id: s._id,
        question: { id: s.question?._id, title: s.question?.title },
        verdict: s.verdict,
        score: s.effectiveScore,
        maxScore: s.maxScore,
        passedCount: s.passedCount,
        totalCount: s.totalCount,
        language: s.language,
        createdAt: s.createdAt,
        overridden: typeof s.manualOverride?.score === 'number',
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// Analytics (§6)
// ---------------------------------------------------------------------------

router.get(
  '/:id/analytics',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user, { populate: true });

    const attempts = await Attempt.find({
      test: test._id,
      status: { $ne: 'in_progress' },
    }).populate('student', 'name email rollNumber');
    const analyticsStats = await statsForAttempts(attempts.map((a) => a._id));
    const submissions = await Submission.find({
      test: test._id,
      kind: { $in: ['submit', 'auto'] },
    }).select('question student verdict score maxScore manualOverride passedCount totalCount');

    // Per question: best attempt per student decides solved / attempted.
    const byQuestion = new Map();
    for (const q of test.questions) {
      byQuestion.set(q._id.toString(), {
        questionId: q._id,
        title: q.title,
        marks: q.marks,
        difficulty: q.difficulty,
        attempted: new Set(),
        solved: new Set(),
        verdicts: {},
        scoreSum: 0,
        scoreCount: 0,
      });
    }

    for (const s of submissions) {
      const entry = byQuestion.get(s.question.toString());
      if (!entry) continue;
      const studentKey = s.student.toString();
      entry.attempted.add(studentKey);
      if (s.verdict === 'Accepted') entry.solved.add(studentKey);
      entry.verdicts[s.verdict] = (entry.verdicts[s.verdict] || 0) + 1;
      entry.scoreSum += typeof s.manualOverride?.score === 'number' ? s.manualOverride.score : s.score;
      entry.scoreCount += 1;
    }

    const questions = [...byQuestion.values()].map((e) => ({
      questionId: e.questionId,
      title: e.title,
      marks: e.marks,
      difficulty: e.difficulty,
      attempted: e.attempted.size,
      solved: e.solved.size,
      passRate: e.attempted.size ? Math.round((e.solved.size / e.attempted.size) * 100) : 0,
      averageScore: e.scoreCount ? Math.round((e.scoreSum / e.scoreCount) * 100) / 100 : 0,
      // The most common failure mode is the single most useful teaching signal.
      verdicts: Object.entries(e.verdicts)
        .map(([verdict, count]) => ({ verdict, count }))
        .sort((a, b) => b.count - a.count),
    }));

    // Class score distribution in 10% bands.
    const bands = Array.from({ length: 10 }, (_, i) => ({
      label: `${i * 10}–${i * 10 + 10}%`,
      count: 0,
    }));
    const percentages = [];
    for (const a of attempts) {
      if (!a.maxScore) continue;
      const pct = (a.score / a.maxScore) * 100;
      percentages.push(pct);
      const idx = Math.min(9, Math.floor(pct / 10));
      bands[idx].count += 1;
    }
    percentages.sort((x, y) => x - y);

    const mean = percentages.length
      ? percentages.reduce((a, b) => a + b, 0) / percentages.length
      : 0;
    const median = percentages.length
      ? percentages.length % 2
        ? percentages[(percentages.length - 1) / 2]
        : (percentages[percentages.length / 2 - 1] + percentages[percentages.length / 2]) / 2
      : 0;

    res.json({
      test: { id: test._id, title: test.title },
      summary: {
        graded: attempts.length,
        terminated: attempts.filter((a) => a.status === 'terminated').length,
        meanPercent: Math.round(mean * 10) / 10,
        medianPercent: Math.round(median * 10) / 10,
        highestPercent: percentages.length ? Math.round(percentages.at(-1) * 10) / 10 : 0,
        lowestPercent: percentages.length ? Math.round(percentages[0] * 10) / 10 : 0,
      },
      questions,
      distribution: bands,
      // One row per student who finished — who they are, when they worked, how
      // much trouble they had, and what they scored.
      students: attempts
        .map((a) => {
          const activity = describeAttempt(a, analyticsStats.get(a._id.toString()));
          return {
            attemptId: a._id,
            ...studentLabel(a),
            status: a.status,
            ...activity,
            warnings: a.warnings,
            score: a.score,
            maxScore: a.maxScore,
            percent: a.maxScore ? Math.round((a.score / a.maxScore) * 1000) / 10 : 0,
          };
        })
        .sort((x, y) => y.percent - x.percent),
    });
  })
);

// ---------------------------------------------------------------------------
// Export (§6)
// ---------------------------------------------------------------------------

router.get(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user, { populate: true });
    const attempts = await Attempt.find({ test: test._id }).populate(
      'student',
      'name email rollNumber'
    );
    const exportStats = await statsForAttempts(attempts.map((a) => a._id));
    const submissions = await Submission.find({
      test: test._id,
      kind: { $in: ['submit', 'auto'] },
    }).select('student question score manualOverride verdict');

    // Best score per student per question.
    const best = new Map();
    for (const s of submissions) {
      const key = `${s.student}|${s.question}`;
      const value = typeof s.manualOverride?.score === 'number' ? s.manualOverride.score : s.score;
      if (!best.has(key) || value > best.get(key).score) best.set(key, { score: value, verdict: s.verdict });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KPR Coding Platform';
    const sheet = workbook.addWorksheet('Results');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Roll no.', key: 'rollNumber', width: 14 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Started', key: 'startedAt', width: 20 },
      { header: 'Completed', key: 'submittedAt', width: 20 },
      { header: 'Time taken', key: 'timeTaken', width: 12 },
      { header: 'Submissions', key: 'submissions', width: 12 },
      { header: 'Errored submissions', key: 'erroredSubmissions', width: 18 },
      { header: 'Runs', key: 'runs', width: 8 },
      { header: 'Warnings', key: 'warnings', width: 10 },
      ...test.questions.map((q, i) => ({
        header: `Q${i + 1}: ${q.title} (/${q.marks})`,
        key: `q${i}`,
        width: 22,
      })),
      // Three score columns, because with negative marking one number cannot
      // tell the whole story: what is recorded, what was actually scored, and
      // how much of it was lost to wrong answers.
      { header: 'Total (recorded)', key: 'total', width: 15 },
      { header: 'Raw total', key: 'rawTotal', width: 11 },
      { header: 'Negative marks', key: 'negative', width: 14 },
      { header: 'Out of', key: 'outOf', width: 10 },
      { header: 'Percent', key: 'percent', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const a of attempts) {
      const who = studentLabel(a);
      const activity = describeAttempt(a, exportStats.get(a._id.toString()));
      const row = {
        name: who.name,
        rollNumber: who.rollNumber,
        email: who.email,
        status: a.status,
        startedAt: activity.startedAt ? new Date(activity.startedAt).toLocaleString() : '',
        submittedAt: activity.finishedAt ? new Date(activity.finishedAt).toLocaleString() : '',
        timeTaken:
          activity.timeTakenMs == null
            ? ''
            : `${Math.floor(activity.timeTakenMs / 60000)}m ${Math.round((activity.timeTakenMs % 60000) / 1000)}s`,
        submissions: activity.submissions,
        erroredSubmissions: activity.erroredSubmissions,
        runs: activity.runs,
        warnings: a.warnings,
        total: a.score,
        rawTotal: 0, // both filled in below, from the per-question scores
        negative: 0,
        outOf: a.maxScore,
        percent: a.maxScore ? Math.round((a.score / a.maxScore) * 1000) / 10 : 0,
      };

      // Both totals are summed from the same per-question figures printed in
      // this row, rather than read off the attempt. That keeps the sheet
      // internally consistent — the Q columns visibly add up to the raw total —
      // and it works for attempts graded before rawScore was ever stored.
      let raw = 0;
      let lost = 0;
      test.questions.forEach((q, i) => {
        const s = best.get(`${a.student?._id}|${q._id}`)?.score;
        row[`q${i}`] = s ?? '';
        if (typeof s === 'number') {
          raw += s;
          if (s < 0) lost += s;
        }
      });
      row.rawTotal = Math.round(raw * 100) / 100;
      row.negative = Math.round(lost * 100) / 100;

      const added = sheet.addRow(row);

      // A third of a mark is 0.3333333333333333, and a column of those is
      // unreadable. The cells keep the exact value — so Excel's own SUM across a
      // row still comes to a clean -2 — and only the display is rounded. Same
      // principle as the grading itself: exact underneath, rounded at the edge.
      test.questions.forEach((q, i) => {
        added.getCell(`q${i}`).numFmt = '0.##';
      });
      for (const key of ['total', 'rawTotal', 'negative']) {
        added.getCell(key).numFmt = '0.##';
      }

      // Red where marks were lost, so a scan down the sheet finds them.
      for (const key of ['rawTotal', 'negative']) {
        if (Number(row[key]) < 0) {
          added.getCell(key).font = { color: { argb: 'FFC0392B' }, bold: true };
        }
      }
    }

    // Students who never started, so the college record is complete. Their
    // names come from the account rather than an attempt — a row that reads
    // only as an email address is no use to whoever files the marks.
    const startedEmails = new Set(attempts.map((a) => a.studentEmail || a.student?.email));
    const absentees = test.allowlist.filter((email) => !startedEmails.has(email));

    if (absentees.length) {
      const accounts = await User.find({ email: { $in: absentees } }).select(
        'email name rollNumber'
      );
      const byEmail = new Map(accounts.map((u) => [u.email, u]));

      for (const email of absentees) {
        const account = byEmail.get(email);
        sheet.addRow({
          // Absent students who never signed in have no account at all, so the
          // email is genuinely all we know about them.
          name: account?.name || '',
          rollNumber: account?.rollNumber || '',
          email,
          status: 'not_started',
          total: 0,
          rawTotal: 0,
          negative: 0,
          outOf: 0,
          percent: 0,
        });
      }
    }

    const safeTitle = test.title.replace(/[^\w\d-]+/g, '_').slice(0, 60);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}_results.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  })
);

// ---------------------------------------------------------------------------
// Manual score override (§6)
// ---------------------------------------------------------------------------

router.post(
  '/submissions/:submissionId/override',
  asyncHandler(async (req, res) => {
    const { score, note } = z
      .object({ score: z.number().min(0).nullable(), note: z.string().default('') })
      .parse(req.body);

    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) throw new ApiError(404, 'Submission not found');

    const test = await loadOwned(submission.test, req.user);
    if (score != null && score > submission.maxScore) {
      throw new ApiError(400, `The maximum for this question is ${submission.maxScore}`);
    }

    submission.manualOverride =
      score == null
        ? { score: undefined, note: '', by: undefined, at: undefined }
        : { score, note, by: req.user._id, at: new Date() };
    await submission.save();

    // Roll the change up into the attempt total.
    const attempt = await Attempt.findById(submission.attempt);
    if (attempt) {
      const { recomputeAttemptScore } = await import('../services/attemptFinalizer.js');
      await recomputeAttemptScore(attempt);
      await attempt.save();
      emitProctor(test._id, 'attempt:rescored', {
        attemptId: attempt._id,
        score: attempt.score,
        maxScore: attempt.maxScore,
      });
    }

    res.json({ submission: { id: submission._id, score: submission.effectiveScore } });
  })
);

router.get(
  '/submissions/:submissionId',
  asyncHandler(async (req, res) => {
    const submission = await Submission.findById(req.params.submissionId)
      .populate('student', 'name email picture rollNumber')
      .populate('question')
      .populate('manualOverride.by', 'name email');
    if (!submission) throw new ApiError(404, 'Submission not found');

    await loadOwned(submission.test, req.user);

    const attempt = await Attempt.findById(submission.attempt).select(
      'warnings violations status startedAt submittedAt terminatedReason'
    );

    res.json({
      submission: {
        id: submission._id,
        student: submission.student,
        question: {
          id: submission.question?._id,
          title: submission.question?.title,
          statement: submission.question?.statement,
          marks: submission.question?.marks,
          timeLimitSec: submission.question?.timeLimitSec,
        },
        language: submission.language,
        code: submission.code,
        kind: submission.kind,
        status: submission.status,
        verdict: submission.verdict,
        error: submission.error,
        // Teachers see full hidden-case detail — students never do.
        results: submission.results,
        passedCount: submission.passedCount,
        totalCount: submission.totalCount,
        score: submission.score,
        effectiveScore: submission.effectiveScore,
        maxScore: submission.maxScore,
        maxTimeMs: submission.maxTimeMs,
        maxMemoryKb: submission.maxMemoryKb,
        pasteSignals: submission.pasteSignals,
        manualOverride: submission.manualOverride,
        createdAt: submission.createdAt,
      },
      attempt: attempt
        ? {
            id: attempt._id,
            status: attempt.status,
            warnings: attempt.warnings,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            terminatedReason: attempt.terminatedReason,
            violations: attempt.violations,
          }
        : null,
    });
  })
);

/** Re-runs a submission whose grading failed because the judge was down. */
router.post(
  '/submissions/:submissionId/regrade',
  asyncHandler(async (req, res) => {
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) throw new ApiError(404, 'Submission not found');
    await loadOwned(submission.test, req.user);

    const question = await Question.findById(submission.question);
    if (!question) throw new ApiError(404, 'The question no longer exists');

    const { gradeSubmission } = await import('../services/grader.js');
    const graded = await gradeSubmission(submission._id, question);

    const attempt = await Attempt.findById(submission.attempt);
    if (attempt) {
      const { recomputeAttemptScore } = await import('../services/attemptFinalizer.js');
      await recomputeAttemptScore(attempt);
      await attempt.save();
    }

    res.json({ submission: { id: graded._id, verdict: graded.verdict, score: graded.score } });
  })
);

/** Adds a student who was missed by the allowlist, mid-exam. */
router.post(
  '/:id/allowlist/add-one',
  asyncHandler(async (req, res) => {
    const test = await loadOwned(req.params.id, req.user);
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const lower = email.toLowerCase();
    if (!test.allowlist.includes(lower)) {
      test.allowlist.push(lower);
      await test.save();
    }
    const exists = await User.exists({ email: lower });
    res.json({ allowlist: test.allowlist, hasAccount: Boolean(exists) });
  })
);

export default router;
