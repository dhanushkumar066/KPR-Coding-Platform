import { Submission } from '../models/Submission.js';

/**
 * Per-attempt activity figures for the teacher's reports: how hard a student
 * worked, how often their code failed to run, and how long they actually took.
 *
 * Derived from the Submission collection rather than stored counters, so the
 * numbers can never drift out of step with the submissions themselves.
 */

/** A submission that never produced a verdict on the student's logic. */
const ERROR_VERDICTS = ['Compile Error', 'Runtime Error', 'Judge Error'];

/**
 * @param {mongoose.Types.ObjectId[]} attemptIds
 * @returns {Promise<Map<string, object>>} keyed by attempt id
 */
export async function statsForAttempts(attemptIds) {
  if (!attemptIds.length) return new Map();

  const rows = await Submission.aggregate([
    { $match: { attempt: { $in: attemptIds } } },
    {
      $group: {
        _id: '$attempt',
        runs: { $sum: { $cond: [{ $eq: ['$kind', 'run'] }, 1, 0] } },
        submissions: { $sum: { $cond: [{ $ne: ['$kind', 'run'] }, 1, 0] } },
        // "Submitted code that errored" — compile/runtime/judge failures, plus
        // anything the judge could not grade at all.
        erroredSubmissions: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$kind', 'run'] },
                  {
                    $or: [
                      { $in: ['$verdict', ERROR_VERDICTS] },
                      { $eq: ['$status', 'error'] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        acceptedSubmissions: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ['$kind', 'run'] }, { $eq: ['$verdict', 'Accepted'] }] },
              1,
              0,
            ],
          },
        },
        // Runs error too, and it is useful to see someone who could not get
        // their code to execute at all before they ever submitted.
        erroredRuns: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$kind', 'run'] },
                  {
                    $or: [
                      { $in: ['$verdict', ERROR_VERDICTS] },
                      { $eq: ['$status', 'error'] },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
        lastSubmissionAt: { $max: '$createdAt' },
      },
    },
  ]);

  return new Map(rows.map((r) => [r._id.toString(), r]));
}

const EMPTY = {
  runs: 0,
  submissions: 0,
  erroredSubmissions: 0,
  acceptedSubmissions: 0,
  erroredRuns: 0,
  lastSubmissionAt: null,
};

/** Merges the aggregate with the attempt's own timing fields. */
export function describeAttempt(attempt, stats = EMPTY) {
  const startedAt = attempt.startedAt || null;
  const finishedAt = attempt.submittedAt || null;
  const timeTakenMs =
    startedAt && finishedAt ? new Date(finishedAt) - new Date(startedAt) : null;

  return {
    startedAt,
    finishedAt,
    timeTakenMs,
    runs: stats.runs ?? 0,
    submissions: stats.submissions ?? 0,
    erroredSubmissions: stats.erroredSubmissions ?? 0,
    acceptedSubmissions: stats.acceptedSubmissions ?? 0,
    erroredRuns: stats.erroredRuns ?? 0,
    lastSubmissionAt: stats.lastSubmissionAt ?? null,
  };
}

/**
 * Summarises paste activity in one question's editor since a given time.
 *
 * Read from the attempt's own violation log — the browser reports each paste,
 * but the record lives server-side and is what the teacher later audits.
 */
export function pasteSignalsFor(attempt, questionId, since = null) {
  const cutoff = since ? new Date(since).getTime() : 0;
  const relevant = attempt.violations.filter(
    (v) =>
      (v.type === 'large_paste' || v.type === 'paste') &&
      String(v.meta?.questionId || '') === String(questionId) &&
      new Date(v.at).getTime() > cutoff
  );

  let totalChars = 0;
  let largestChars = 0;
  for (const v of relevant) {
    const length = Number(v.meta?.length || 0);
    totalChars += length;
    largestChars = Math.max(largestChars, length);
  }

  return {
    events: relevant.length,
    totalChars,
    largestChars,
    lastAt: relevant.length ? relevant.at(-1).at : undefined,
  };
}

/** Name a teacher should see, falling back sensibly for older attempts. */
export function studentLabel(attempt) {
  return {
    name: attempt.studentName || attempt.student?.name || '',
    rollNumber: attempt.studentRollNumber || attempt.student?.rollNumber || '',
    email: attempt.studentEmail || attempt.student?.email || '',
  };
}
