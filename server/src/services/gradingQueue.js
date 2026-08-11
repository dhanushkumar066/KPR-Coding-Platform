import { env } from '../config/env.js';
import { Attempt } from '../models/Attempt.js';
import { Question } from '../models/Question.js';
import { Submission } from '../models/Submission.js';
import { gradeSubmission } from './grader.js';
import { recomputeAttemptScore } from './attemptFinalizer.js';
import { emitProctor } from './realtime.js';

/**
 * Grading happens after the HTTP response, not inside it.
 *
 * Holding a request open for the length of a Judge0 round trip is fine for one
 * student and disastrous for five hundred: every browser sits on a spinner,
 * proxies start timing out, and a client that gives up loses the result even
 * though the work completed. The submission row is already persisted
 * (non-negotiable #4), so the safe shape is: return the id immediately, grade in
 * the background, let the client poll.
 */

let inFlight = 0;
let graded = 0;
let failed = 0;

/**
 * Two submissions for the same attempt would otherwise read-modify-write the
 * attempt's score concurrently and one would clobber the other. Work for a
 * given attempt is chained so the total is always consistent.
 */
const attemptChains = new Map();

function serializeByAttempt(attemptId, fn) {
  const key = String(attemptId);
  const previous = attemptChains.get(key) || Promise.resolve();
  const next = previous.then(fn, fn);
  // Only clear if nothing else queued behind us in the meantime.
  attemptChains.set(
    key,
    next.finally(() => {
      if (attemptChains.get(key) === next) attemptChains.delete(key);
    })
  );
  return next;
}

/** True if the submission was deleted out from under the grader. */
async function vanished(submissionId) {
  return (await Submission.countDocuments({ _id: submissionId }).catch(() => 1)) === 0;
}

/**
 * Queues one submission for grading. Returns immediately; the caller should
 * hand the submission id back to the client to poll.
 */
export function enqueueGrading(submissionId, { testId, studentEmail } = {}) {
  inFlight += 1;

  const work = async () => {
    try {
      const submission = await Submission.findById(submissionId);
      if (!submission) return;

      const question = await Question.findById(submission.question);
      if (!question) {
        submission.set({
          status: 'error',
          verdict: 'Judge Error',
          error: 'The question no longer exists',
          gradedAt: new Date(),
        });
        await submission.save();
        return;
      }

      const result = await gradeSubmission(submissionId, question, {
        scored: submission.kind !== 'run',
      });

      // Runs never affect the score, so there is nothing to roll up.
      if (submission.kind !== 'run' && submission.attempt) {
        await serializeByAttempt(submission.attempt, async () => {
          const attempt = await Attempt.findById(submission.attempt);
          if (!attempt) return;
          await recomputeAttemptScore(attempt);
          await attempt.save();
        });
      }

      graded += 1;

      if (submission.kind !== 'run' && testId) {
        emitProctor(testId, 'attempt:submission', {
          attemptId: submission.attempt,
          studentEmail,
          questionId: submission.question,
          verdict: result.verdict,
          score: result.score,
          maxScore: result.maxScore,
        });
      }
    } catch (err) {
      // A teacher deleting a test while its last submissions are still grading
      // is normal, not a fault. Mongoose reports the vanished document as a
      // VersionError on save; there is nothing left to mark as failed.
      if (await vanished(submissionId)) return;

      failed += 1;
      console.error('[grading] failed for', String(submissionId), err.message);
      // Never leave a row stuck on "pending" — a teacher can re-grade an error.
      await Submission.findByIdAndUpdate(submissionId, {
        status: 'error',
        verdict: 'Judge Error',
        error: err.message || 'Grading failed',
        gradedAt: new Date(),
      }).catch(() => {});
    } finally {
      inFlight -= 1;
    }
  };

  // Fire and forget: the executor's limiter is what actually bounds the work.
  work();
}

export const gradingStats = () => ({ inFlight, graded, failed });

/**
 * A restart mid-exam would otherwise leave submissions pending forever. Re-queues
 * anything that was in flight when the process died.
 */
export async function recoverPendingSubmissions() {
  const stale = await Submission.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(env.gradingMaxQueue)
    .select('_id test');

  if (!stale.length) return 0;

  console.log(`[grading] re-queueing ${stale.length} submission(s) left pending by a restart`);
  for (const s of stale) enqueueGrading(s._id, { testId: s.test });
  return stale.length;
}
