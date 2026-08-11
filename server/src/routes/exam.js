import express from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { Test } from '../models/Test.js';
import { Question } from '../models/Question.js';
import { Attempt } from '../models/Attempt.js';
import { Submission } from '../models/Submission.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';
import { requireAuth } from '../middleware/auth.js';
import { enqueueGrading } from '../services/gradingQueue.js';
import { applyViolation } from '../services/violations.js';
import { emitProctor } from '../services/realtime.js';
import {
  assertOnAllowlist,
  assertProfileComplete,
  assertPublished,
  assertWithinWindow,
  assertSingleSession,
  buildQuestionOrder,
  computeEndsAt,
  loadActiveAttempt,
  newSessionId,
} from '../services/accessGate.js';
import { finalizeAttempt, finalizeIfExpired, recomputeAttemptScore } from '../services/attemptFinalizer.js';
import { pasteSignalsFor } from '../services/attemptStats.js';
import { mcqReview } from '../services/mcqGrader.js';
import { natReview } from '../services/natGrader.js';
import { buildDraftPatch } from '../services/draftPatch.js';
import {
  checkFullscreenDeadline,
  noteFullscreenExit,
  noteFullscreenRestored,
} from '../services/fullscreenWatch.js';

const router = express.Router();
router.use(requireAuth);

// A student hammering Run should not be able to saturate the judge for the
// whole class. Generous enough not to interfere with genuine work.
const executionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a moment — too many runs in the last minute' },
});

/** Loads a test and applies the full access gate (§5). */
async function gateTest(testId, user, { requireWindow = true } = {}) {
  const test = await Test.findById(testId);
  if (!test) throw new ApiError(404, 'Test not found');

  assertPublished(test);
  assertOnAllowlist(test, user);
  if (requireWindow) assertWithinWindow(test);

  return test;
}

function assertNotPaused(test) {
  if (test.paused) {
    throw new ApiError(423, 'Your teacher has paused this test — wait for it to resume');
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

router.get(
  '/tests',
  asyncHandler(async (req, res) => {
    const tests = await Test.find({
      status: 'published',
      allowlist: req.user.email,
    }).sort({ startAt: 1 });

    const attempts = await Attempt.find({
      student: req.user._id,
      test: { $in: tests.map((t) => t._id) },
    }).select('test status score maxScore submittedAt endsAt');
    const attemptByTest = new Map(attempts.map((a) => [a.test.toString(), a]));

    const now = new Date();
    res.json({
      tests: tests.map((t) => {
        const attempt = attemptByTest.get(t._id.toString());
        const window = now < t.startAt ? 'upcoming' : now > t.endAt ? 'closed' : 'open';
        return {
          ...t.toStudentView(),
          window,
          attempt: attempt
            ? {
                status: attempt.status,
                submittedAt: attempt.submittedAt,
                endsAt: attempt.endsAt,
                score: attempt.status === 'in_progress' ? null : attempt.score,
                maxScore: attempt.maxScore,
              }
            : null,
        };
      }),
    });
  })
);

// ---------------------------------------------------------------------------
// Starting / resuming
// ---------------------------------------------------------------------------

/**
 * Starts a new attempt or resumes an existing one. Resuming is deliberately
 * ordinary: a browser crash or dropped connection must never be treated as
 * cheating (§9), so the student comes back to their auto-saved code with the
 * same warning count and the same personal deadline.
 */
router.post(
  '/tests/:testId/start',
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user);
    assertNotPaused(test);
    assertProfileComplete(req.user);

    const { sessionId: clientSessionId } = z
      .object({ sessionId: z.string().optional() })
      .parse(req.body || {});

    let attempt = await Attempt.findOne({ test: test._id, student: req.user._id });
    const now = new Date();

    if (attempt) {
      await finalizeIfExpired(attempt, test, now);
      if (attempt.status !== 'in_progress') {
        throw new ApiError(409, 'You have already finished this test', {
          status: attempt.status,
        });
      }
      assertSingleSession(attempt, clientSessionId);
      attempt.sessionId = clientSessionId || attempt.sessionId || newSessionId();
      attempt.lastHeartbeatAt = now;
      await attempt.save();
    } else {
      const questionOrder = buildQuestionOrder(test);
      if (!questionOrder.length) throw new ApiError(409, 'This test has no questions yet');

      try {
        attempt = await Attempt.create({
          test: test._id,
          student: req.user._id,
          studentEmail: req.user.email,
          studentName: req.user.name,
          studentRollNumber: req.user.rollNumber,
          status: 'in_progress',
          startedAt: now,
          endsAt: computeEndsAt(test, now),
          questionOrder,
          sessionId: clientSessionId || newSessionId(),
          lastHeartbeatAt: now,
        });

        emitProctor(test._id, 'attempt:started', {
          attemptId: attempt._id,
          student: { id: req.user._id, name: req.user.name, email: req.user.email },
        });
      } catch (err) {
        // Finding no attempt and then creating one is not atomic, and this
        // route is called with retries: a slow first response, a double-click
        // on Start, or React re-running the effect all fire it twice. Both
        // calls find nothing, both insert, and the unique index on
        // {test, student} rejects the loser — which surfaced to the student as
        // "That record already exists" and locked them out of their own exam.
        //
        // The winner's attempt is exactly the one this request wanted, so adopt
        // it and carry on. Nothing is lost: whichever insert won holds the same
        // question order this request would have built.
        if (err?.code !== 11000) throw err;

        attempt = await Attempt.findOne({ test: test._id, student: req.user._id });
        if (!attempt) throw err;

        assertSingleSession(attempt, clientSessionId);
        attempt.sessionId = clientSessionId || attempt.sessionId || newSessionId();
        attempt.lastHeartbeatAt = now;
        await attempt.save();
      }
    }

    const questions = await Question.find({ _id: { $in: attempt.questionOrder } });
    const byId = new Map(questions.map((q) => [q._id.toString(), q]));
    const ordered = attempt.questionOrder
      .map((id) => byId.get(id.toString()))
      .filter(Boolean)
      // Seeded by attempt, so each student gets their own stable option order.
      .map((q) => q.toStudentView(test.allowedLanguages, attempt._id.toString()));

    const drafts = {};
    for (const d of attempt.drafts) {
      drafts[d.question.toString()] = {
        language: d.language,
        code: d.code,
        selectedOptions: d.selectedOptions || [],
        natAnswer: d.natAnswer || '',
        markedForReview: Boolean(d.markedForReview),
        visited: Boolean(d.visited),
        updatedAt: d.updatedAt,
      };
    }

    res.json({
      test: test.toStudentView(),
      attempt: attempt.toStudentView(now),
      questions: ordered,
      drafts,
    });
  })
);

// ---------------------------------------------------------------------------
// In-exam state
// ---------------------------------------------------------------------------

/**
 * Heartbeat. Doubles as the authoritative clock: the client's countdown is only
 * a display, and the server ends the attempt the moment the deadline passes.
 */
router.post(
  '/tests/:testId/heartbeat',
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user, { requireWindow: false });
    // The full document is loaded on purpose: an expiring attempt needs its
    // drafts to grade, and the fullscreen path appends to the violation log.
    const attempt = await loadActiveAttempt(test._id, req.user._id, { allowFinished: true });
    const { sessionId } = z.object({ sessionId: z.string().optional() }).parse(req.body || {});

    if (attempt.status === 'in_progress') {
      const finished = await finalizeIfExpired(attempt, test);
      if (finished.status !== 'in_progress') {
        emitProctor(test._id, 'attempt:finished', {
          attemptId: attempt._id,
          status: finished.status,
        });
        return res.json({
          status: finished.status,
          timeRemainingMs: 0,
          warnings: attempt.warnings,
          reason: 'Time expired — your work was submitted and graded automatically',
        });
      }

      // Catches a student whose page stopped counting down — a frozen tab, or a
      // tampered client. The browser cannot opt out of this.
      const fs = checkFullscreenDeadline(attempt, test);
      if (fs.expired) {
        attempt.violations.push({
          type: 'fullscreen_deadline_missed',
          at: new Date(),
          durationMs: fs.msOut,
          counted: true,
          reason: `Stayed out of fullscreen for more than ${Math.round(fs.deadlineMs / 1000)}s`,
        });
        await finalizeAttempt(attempt, test, {
          status: 'terminated',
          reason: `Did not return to fullscreen within ${Math.round(fs.deadlineMs / 1000)} seconds`,
        });

        emitProctor(test._id, 'attempt:terminated', {
          attemptId: attempt._id,
          studentEmail: attempt.studentEmail,
          warnings: attempt.warnings,
          reason: 'fullscreen deadline',
        });

        return res.json({
          status: attempt.status,
          timeRemainingMs: 0,
          warnings: attempt.warnings,
          reason: 'You did not return to fullscreen in time — your work was submitted and graded',
        });
      }

      assertSingleSession(attempt, sessionId);

      // A targeted update, not attempt.save(): with a full class this fires
      // every few seconds per student, and rewriting the whole document
      // (drafts and the violation log included) would dominate the database
      // load for the sake of one timestamp.
      await Attempt.updateOne(
        { _id: attempt._id },
        { $set: { lastHeartbeatAt: new Date(), ...(sessionId ? { sessionId } : {}) } }
      );
    }

    const fsState = checkFullscreenDeadline(attempt, test);
    res.json({
      status: attempt.status,
      timeRemainingMs: attempt.timeRemainingMs(),
      warnings: attempt.warnings,
      warningLimit: test.warningLimit,
      paused: test.paused,
      // Lets the client re-sync its countdown against the server's clock.
      fullscreen: {
        outOfFullscreen: Boolean(attempt.fullscreenExitAt),
        remainingMs: fsState.remainingMs,
        deadlineMs: fsState.deadlineMs,
        enforced: fsState.deadlineMs > 0 && attempt.fullscreenEverEntered,
      },
    });
  })
);

/** Auto-save (§9). Cheap, frequent, and never grades anything. */
router.post(
  '/tests/:testId/autosave',
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user, { requireWindow: false });
    const attempt = await loadActiveAttempt(test._id, req.user._id);

    const { questionId, language, code, selectedOptions, natAnswer, markedForReview, visited } = z
      .object({
        questionId: z.string(),
        language: z.string().default(''),
        code: z.string().max(200_000).default(''),
        // MCQ selections and NAT answers use the same autosave path as code, so
        // resume-after-crash and grading-on-finish work identically for all
        // three kinds.
        selectedOptions: z.array(z.string()).max(50).optional(),
        natAnswer: z.string().max(64).optional(),
        // Navigation state, saved alongside the answer so it survives a reload
        // or a crash the same way the answer does.
        markedForReview: z.boolean().optional(),
        visited: z.boolean().optional(),
      })
      .parse(req.body);

    if (!attempt.questionOrder.some((q) => q.toString() === questionId)) {
      throw new ApiError(400, 'That question is not part of your paper');
    }

    const existing = attempt.drafts.find((d) => d.question.toString() === questionId);

    // Navigation state travels on its own: marking a question for review must
    // not disturb the answer already saved against it. See draftPatch.js.
    const patch = buildDraftPatch({
      language,
      code,
      selectedOptions,
      natAnswer,
      markedForReview,
      visited,
    });

    if (existing) {
      Object.assign(existing, patch);
    } else {
      attempt.drafts.push({ question: questionId, ...patch });
    }
    attempt.lastHeartbeatAt = new Date();
    await attempt.save();

    res.json({ savedAt: new Date() });
  })
);

/**
 * Violation reporting. The client says only *what happened*; this endpoint
 * decides whether it costs a warning and whether the attempt ends
 * (non-negotiable #5).
 */
router.post(
  '/tests/:testId/violation',
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user, { requireWindow: false });
    const attempt = await loadActiveAttempt(test._id, req.user._id);

    const event = z
      .object({
        type: z.string(),
        durationMs: z.number().min(0).max(3_600_000).default(0),
        meta: z.record(z.string(), z.any()).default({}),
      })
      .parse(req.body);

    // Keep the fullscreen clock in step before judging anything.
    if (event.type === 'fullscreen_exit') noteFullscreenExit(attempt);
    if (event.type === 'fullscreen_restored') noteFullscreenRestored(attempt);

    const outcome = applyViolation(attempt, test, event);

    // The deadline is the server's call, not the countdown in the page.
    const fs = checkFullscreenDeadline(attempt, test);
    if (fs.expired) {
      attempt.violations.push({
        type: 'fullscreen_deadline_missed',
        at: new Date(),
        durationMs: fs.msOut,
        counted: true,
        reason: `Stayed out of fullscreen for more than ${Math.round(fs.deadlineMs / 1000)}s`,
      });
      await finalizeAttempt(attempt, test, {
        status: 'terminated',
        reason: `Did not return to fullscreen within ${Math.round(fs.deadlineMs / 1000)} seconds`,
      });

      emitProctor(test._id, 'attempt:terminated', {
        attemptId: attempt._id,
        studentEmail: attempt.studentEmail,
        warnings: attempt.warnings,
        reason: 'fullscreen deadline',
      });

      return res.json({
        counted: outcome.counted,
        reason: outcome.reason,
        warnings: outcome.warnings,
        limit: outcome.limit,
        terminated: true,
        message:
          'Your attempt has been ended because you did not return to fullscreen in time. Your work was submitted and graded — your teacher will review it.',
      });
    }

    await attempt.save();

    emitProctor(test._id, 'attempt:violation', {
      attemptId: attempt._id,
      studentEmail: attempt.studentEmail,
      type: event.type,
      counted: outcome.counted,
      reason: outcome.reason,
      warnings: outcome.warnings,
      limit: outcome.limit,
    });

    if (outcome.terminated) {
      // Auto-submit and GRADE whatever they have — never auto-zero (§9).
      await finalizeAttempt(attempt, test, {
        status: 'terminated',
        reason: `Exceeded the limit of ${outcome.limit} warnings`,
      });

      emitProctor(test._id, 'attempt:terminated', {
        attemptId: attempt._id,
        studentEmail: attempt.studentEmail,
        warnings: attempt.warnings,
      });

      return res.json({
        counted: outcome.counted,
        reason: outcome.reason,
        warnings: outcome.warnings,
        limit: outcome.limit,
        terminated: true,
        message:
          'Your attempt has been ended for exam-rule violations. Your work was submitted and graded — your teacher will review it.',
      });
    }

    res.json({
      counted: outcome.counted,
      reason: outcome.reason,
      warnings: outcome.warnings,
      limit: outcome.limit,
      terminated: false,
    });
  })
);

// ---------------------------------------------------------------------------
// Run & Submit (§7, §8)
// ---------------------------------------------------------------------------

const codeSchema = z.object({
  questionId: z.string(),
  language: z.string(),
  code: z.string().min(1, 'Write some code first').max(200_000),
  // Idempotency key for one press of the button — see Submission.clientToken.
  clientToken: z.string().trim().max(64).default(''),
  // Run only: the student's own input instead of the sample cases.
  customInput: z.string().max(20_000).default(''),
});

/**
 * Returns the submission this token already created, if any.
 *
 * A dropped connection is indistinguishable from a lost response, so the
 * browser retries; this makes that retry free rather than duplicating the
 * student's answer.
 */
async function findByClientToken(studentId, clientToken) {
  if (!clientToken) return null;
  return Submission.findOne({ student: studentId, clientToken }).select('_id status');
}

/**
 * Creates the submission, treating a duplicate-key collision as the same
 * replay the lookup above catches — two retries can race past that lookup, and
 * the unique index is what actually decides which one wins.
 *
 * `created` is false for the loser of that race, whose caller must not queue
 * the work a second time.
 */
async function createSubmissionOnce(doc, studentId, clientToken) {
  try {
    // Storing no field at all when there is no token keeps those documents out
    // of the partial unique index.
    const submission = await Submission.create(clientToken ? { ...doc, clientToken } : doc);
    return { submission, created: true };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const existing = await findByClientToken(studentId, clientToken);
    if (!existing) throw err;
    return { submission: existing, created: false };
  }
}

async function loadQuestionForAttempt(attempt, questionId, test) {
  if (!attempt.questionOrder.some((q) => q.toString() === questionId)) {
    throw new ApiError(400, 'That question is not part of your paper');
  }
  const question = await Question.findById(questionId);
  if (!question) throw new ApiError(404, 'Question not found');
  if (question.kind !== 'coding') {
    // Only code can be run. MCQ and NAT answers are auto-saved and graded when
    // the attempt finishes; there is nothing to execute, and grading either on
    // demand would leak the answer key. Testing for the kind that CAN run means
    // a future kind is refused by default rather than reaching the judge.
    throw new ApiError(
      400,
      question.kind === 'nat'
        ? 'Numerical answers are saved automatically, not submitted'
        : 'Multiple-choice answers are saved automatically, not submitted'
    );
  }
  return question;
}

function assertLanguageAllowed(test, language) {
  if (!test.allowedLanguages.includes(language)) {
    throw new ApiError(400, `${language} is not permitted in this test`);
  }
}

/** Run: visible sample cases only, no score, no penalty (§7). */
router.post(
  '/tests/:testId/run',
  executionLimiter,
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user, { requireWindow: false });
    assertNotPaused(test);
    const attempt = await loadActiveAttempt(test._id, req.user._id);
    await finalizeIfExpired(attempt, test);
    if (attempt.status !== 'in_progress') throw new ApiError(409, 'Your time is up');

    const { questionId, language, code, clientToken, customInput } = codeSchema.parse(req.body);
    assertLanguageAllowed(test, language);

    const replayed = await findByClientToken(req.user._id, clientToken);
    if (replayed) {
      return res.status(202).json({ submissionId: replayed._id, status: replayed.status });
    }

    const question = await loadQuestionForAttempt(attempt, questionId, test);

    // With their own input there is nothing to run against but that input; only
    // the sample-driven run needs samples to exist.
    if (!customInput.trim() && !question.testCases.some((c) => c.isSample)) {
      throw new ApiError(400, 'This question has no sample cases to run against');
    }

    // Persisted before execution, like every other submission (non-negotiable #4).
    const { submission, created } = await createSubmissionOnce(
      {
        attempt: attempt._id,
        test: test._id,
        question: question._id,
        student: req.user._id,
        kind: 'run',
        language,
        code,
        status: 'pending',
        maxScore: 0,
        customInput: customInput.trim() ? customInput : '',
      },
      req.user._id,
      clientToken
    );
    if (!created) {
      return res.status(202).json({ submissionId: submission._id, status: submission.status });
    }

    enqueueGrading(submission._id, { testId: test._id, studentEmail: attempt.studentEmail });
    res.status(202).json({ submissionId: submission._id, status: 'pending' });
  })
);

/** Submit: every case including hidden ones, scored (§7, §8). */
router.post(
  '/tests/:testId/submit',
  executionLimiter,
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user, { requireWindow: false });
    assertNotPaused(test);
    const attempt = await loadActiveAttempt(test._id, req.user._id);
    await finalizeIfExpired(attempt, test);
    if (attempt.status !== 'in_progress') throw new ApiError(409, 'Your time is up');

    const { questionId, language, code, clientToken } = codeSchema.parse(req.body);
    assertLanguageAllowed(test, language);

    const replayed = await findByClientToken(req.user._id, clientToken);
    if (replayed) {
      return res.status(202).json({ submissionId: replayed._id, status: replayed.status });
    }

    const question = await loadQuestionForAttempt(attempt, questionId, test);

    // Only pastes since their previous submission of this question — otherwise
    // one early paste would follow them through every later attempt.
    const previous = await Submission.findOne({
      attempt: attempt._id,
      question: question._id,
      kind: { $in: ['submit', 'auto'] },
    })
      .sort({ createdAt: -1 })
      .select('createdAt');

    const { submission, created } = await createSubmissionOnce(
      {
        attempt: attempt._id,
        test: test._id,
        question: question._id,
        student: req.user._id,
        kind: 'submit',
        language,
        code,
        status: 'pending',
        maxScore: question.marks,
        pasteSignals: pasteSignalsFor(attempt, question._id, previous?.createdAt),
      },
      req.user._id,
      clientToken
    );
    // Lost the insert race to the student's own retry — that submission is
    // already queued, so don't queue it a second time.
    if (!created) {
      return res.status(202).json({ submissionId: submission._id, status: submission.status });
    }

    // Keep the draft in step so a later termination re-submits this same code.
    const draft = attempt.drafts.find((d) => d.question.toString() === questionId);
    if (draft) {
      draft.language = language;
      draft.code = code;
      draft.updatedAt = new Date();
    } else {
      attempt.drafts.push({ question: questionId, language, code, updatedAt: new Date() });
    }
    await attempt.save();

    // Grading happens after the response so a whole class can submit at once
    // without every request sitting open for a Judge0 round trip.
    enqueueGrading(submission._id, { testId: test._id, studentEmail: attempt.studentEmail });
    res.status(202).json({ submissionId: submission._id, status: 'pending' });
  })
);

/**
 * Polled by the solve screen after a run or submit. Cheap on purpose — a class
 * of 500 polling every second must not cost more than the grading itself.
 */
router.get(
  '/submissions/:submissionId/result',
  asyncHandler(async (req, res) => {
    const submission = await Submission.findOne({
      _id: req.params.submissionId,
      student: req.user._id,
    }).select(
      'kind questionKind status verdict error hint results passedCount totalCount score maxScore ' +
        'maxTimeMs maxMemoryKb pasteSignals language question createdAt manualOverride customInput'
    );
    if (!submission) throw new ApiError(404, 'Submission not found');

    if (submission.status === 'pending') {
      return res.json({ status: 'pending', submissionId: submission._id });
    }
    res.json({ status: submission.status, result: submission.toStudentView() });
  })
);

/** The student chooses to finish early. */
router.post(
  '/tests/:testId/finish',
  asyncHandler(async (req, res) => {
    const test = await gateTest(req.params.testId, req.user, { requireWindow: false });
    // Tolerates an already-finished attempt: if the response to the first
    // finish was lost the browser will send it again, and being told "your
    // attempt is over" at that moment reads as an error to the student.
    const attempt = await loadActiveAttempt(test._id, req.user._id, { allowFinished: true });

    if (attempt.status === 'in_progress') {
      await finalizeAttempt(attempt, test, { status: 'submitted' });
      emitProctor(test._id, 'attempt:finished', { attemptId: attempt._id, status: attempt.status });
    }

    res.json({
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
    });
  })
);

// ---------------------------------------------------------------------------
// Results (§7)
// ---------------------------------------------------------------------------

router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const attempts = await Attempt.find({ student: req.user._id, status: { $ne: 'in_progress' } })
      .populate('test', 'title endAt isPractice')
      .sort({ submittedAt: -1 });

    res.json({
      results: attempts.map((a) => ({
        attemptId: a._id,
        test: { id: a.test?._id, title: a.test?.title, isPractice: a.test?.isPractice },
        status: a.status,
        submittedAt: a.submittedAt,
        score: a.score,
        maxScore: a.maxScore,
        warnings: a.warnings,
        terminatedReason: a.terminatedReason,
      })),
    });
  })
);

router.get(
  '/results/:attemptId',
  asyncHandler(async (req, res) => {
    const attempt = await Attempt.findOne({ _id: req.params.attemptId, student: req.user._id })
      .populate('test', 'title endAt isPractice allowedLanguages')
      // `nat` belongs here alongside `mcq` — without it the answer key for a
      // numerical question comes back with an empty accepted range.
      .populate('questionOrder', 'title marks statement constraints difficulty kind mcq nat');
    if (!attempt) throw new ApiError(404, 'Result not found');
    if (attempt.status === 'in_progress') {
      throw new ApiError(409, 'This attempt is still in progress');
    }

    const submissions = await Submission.find({
      attempt: attempt._id,
      kind: { $in: ['submit', 'auto'] },
    }).sort({ createdAt: -1 });

    // Best submission per question is what counted.
    const bestByQuestion = new Map();
    for (const s of submissions) {
      const key = s.question.toString();
      const current = bestByQuestion.get(key);
      if (!current || s.effectiveScore > current.effectiveScore) bestByQuestion.set(key, s);
    }

    res.json({
      attempt: {
        id: attempt._id,
        test: attempt.test,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        score: attempt.score,
        maxScore: attempt.maxScore,
        warnings: attempt.warnings,
        terminatedReason: attempt.terminatedReason,
      },
      questions: attempt.questionOrder.map((q) => {
        const best = bestByQuestion.get(q._id.toString());
        return {
          id: q._id,
          title: q.title,
          marks: q.marks,
          difficulty: q.difficulty,
          kind: q.kind || 'coding',
          // The attempt is over, so the answer key can finally be shown.
          mcqReview:
            q.kind === 'mcq' ? mcqReview(q, best?.selectedOptions || []) : null,
          // NAT needs one too: without it a student sees they lost the marks
          // but never learns what the accepted answer was.
          natReview: q.kind === 'nat' ? natReview(q, best?.natAnswer ?? '') : null,
          best: best ? best.toStudentView() : null,
        };
      }),
      // Every attempt at each question, so a student can see their progression.
      allSubmissions: submissions.map((s) => ({
        id: s._id,
        question: s.question,
        verdict: s.verdict,
        score: s.effectiveScore,
        maxScore: s.maxScore,
        language: s.language,
        createdAt: s.createdAt,
      })),
    });
  })
);

/** A student may re-read their own code after the fact. */
router.get(
  '/submissions/:submissionId',
  asyncHandler(async (req, res) => {
    const submission = await Submission.findOne({
      _id: req.params.submissionId,
      student: req.user._id,
    });
    if (!submission) throw new ApiError(404, 'Submission not found');

    const attempt = await Attempt.findById(submission.attempt).select('status');
    if (attempt?.status === 'in_progress' && submission.kind !== 'run') {
      throw new ApiError(409, 'Available once your attempt is finished');
    }

    res.json({ submission: { ...submission.toStudentView(), code: submission.code } });
  })
);

export default router;
