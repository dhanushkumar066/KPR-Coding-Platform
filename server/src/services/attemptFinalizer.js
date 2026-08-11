import { Submission } from '../models/Submission.js';
import { Question } from '../models/Question.js';
import { gradeSubmission } from './grader.js';
import { pasteSignalsFor } from './attemptStats.js';
import { gradeMcq } from './mcqGrader.js';
import { gradeNat } from './natGrader.js';

/**
 * Recomputes an attempt's score as the sum of each question's best result.
 * A teacher's manual override always wins over the machine score.
 */
export async function recomputeAttemptScore(attempt) {
  const questionIds = attempt.questionOrder.map((q) => q._id ?? q);
  const questions = await Question.find({ _id: { $in: questionIds } }).select('marks');
  const marksById = new Map(questions.map((q) => [q._id.toString(), q.marks]));

  const submissions = await Submission.find({
    attempt: attempt._id,
    kind: { $in: ['submit', 'auto'] },
  }).select('question score manualOverride');

  const bestByQuestion = new Map();
  for (const sub of submissions) {
    const key = sub.question.toString();
    const value =
      typeof sub.manualOverride?.score === 'number' ? sub.manualOverride.score : sub.score;
    if (!bestByQuestion.has(key) || value > bestByQuestion.get(key)) {
      bestByQuestion.set(key, value);
    }
  }

  const score = [...bestByQuestion.values()].reduce((a, b) => a + b, 0);
  const maxScore = questionIds.reduce((sum, id) => sum + (marksById.get(id.toString()) || 0), 0);

  // Negative marking can push a paper below zero. Both figures are kept:
  //
  //   score     what goes on the mark sheet, floored at zero — a college
  //             record showing -3 out of 21 is not something anyone can file.
  //   rawScore  what the paper actually came to, negative and all.
  //
  // Flooring alone would throw away the more informative number: a student on
  // exactly 0 who answered nothing and one who guessed their way to -7 are very
  // different situations, and a teacher reviewing a GATE paper needs to tell
  // them apart. Rounding happens once, here, on the exact accumulated total.
  const rounded = Math.round(score * 100) / 100;
  attempt.rawScore = rounded;
  attempt.score = Math.max(0, rounded);
  attempt.maxScore = maxScore;
  attempt.gradedAt = new Date();
  return attempt;
}

/**
 * Ends an attempt and grades whatever the student had.
 *
 * Used for a normal finish, for running out of time, and for termination on
 * violations. In every case any unsubmitted draft is submitted and graded —
 * a terminated student is never auto-zeroed (§9); the teacher makes the final
 * call with the manual override.
 *
 * @param {'submitted'|'auto_submitted'|'terminated'} status
 */
export async function finalizeAttempt(attempt, test, { status, reason = '' } = {}) {
  if (attempt.status !== 'in_progress') return attempt;

  attempt.status = status;
  attempt.submittedAt = new Date();
  if (reason) attempt.terminatedReason = reason;
  await attempt.save();

  const questionIds = attempt.questionOrder.map((q) => (q._id ?? q).toString());
  const questions = await Question.find({ _id: { $in: questionIds } });
  const questionById = new Map(questions.map((q) => [q._id.toString(), q]));

  for (const questionId of questionIds) {
    const question = questionById.get(questionId);
    if (!question) continue;

    const draft = attempt.drafts.find((d) => d.question.toString() === questionId);

    // NAT, like MCQ, is graded only here. Telling a student their number was
    // wrong mid-exam would turn a numerical answer into a guessing game.
    if (question.kind === 'nat') {
      const given = draft?.natAnswer || '';
      const outcome = gradeNat(question, given);
      await Submission.findOneAndUpdate(
        { attempt: attempt._id, question: questionId, kind: 'auto' },
        {
          attempt: attempt._id,
          test: test._id,
          question: questionId,
          student: attempt.student,
          kind: 'auto',
          questionKind: 'nat',
          natAnswer: given,
          status: 'graded',
          verdict: outcome.verdict,
          score: outcome.score,
          maxScore: question.marks,
          passedCount: outcome.verdict === 'Correct' ? 1 : 0,
          totalCount: 1,
          gradedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      continue;
    }

    // MCQ is graded only here, never on submit. Revealing correctness during
    // the exam would let a student brute-force the right option by resubmitting.
    if (question.kind === 'mcq') {
      const selected = draft?.selectedOptions || [];
      const outcome = gradeMcq(question, selected);
      await Submission.findOneAndUpdate(
        { attempt: attempt._id, question: questionId, kind: 'auto' },
        {
          attempt: attempt._id,
          test: test._id,
          question: questionId,
          student: attempt.student,
          kind: 'auto',
          questionKind: 'mcq',
          selectedOptions: selected,
          status: 'graded',
          verdict: outcome.verdict,
          score: outcome.score,
          maxScore: question.marks,
          passedCount: outcome.hits,
          totalCount: outcome.correctCount,
          gradedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      continue;
    }

    if (!draft?.code?.trim()) continue;

    // Skip if they already submitted this exact code — no point re-running it.
    const latest = await Submission.findOne({
      attempt: attempt._id,
      question: questionId,
      kind: { $in: ['submit', 'auto'] },
    }).sort({ createdAt: -1 });

    if (latest && latest.code === draft.code && latest.language === draft.language) continue;

    // Persist before grading (non-negotiable #4).
    const submission = await Submission.create({
      attempt: attempt._id,
      test: test._id,
      question: questionId,
      student: attempt.student,
      kind: 'auto',
      language: draft.language,
      code: draft.code,
      status: 'pending',
      maxScore: question.marks,
      pasteSignals: pasteSignalsFor(attempt, questionId, latest?.createdAt),
    });

    try {
      await gradeSubmission(submission._id, question);
    } catch (err) {
      console.error('[finalize] grading failed for submission', submission._id.toString(), err);
    }
  }

  await recomputeAttemptScore(attempt);
  await attempt.save();
  return attempt;
}

/**
 * Ends any attempt whose personal deadline has passed. Called opportunistically
 * whenever an attempt is touched, so a student who simply closes the laptop
 * still gets their work graded.
 */
export async function finalizeIfExpired(attempt, test, now = new Date()) {
  if (attempt.status !== 'in_progress') return attempt;
  if (attempt.endsAt.getTime() > now.getTime()) return attempt;
  return finalizeAttempt(attempt, test, {
    status: 'auto_submitted',
    reason: 'Time expired',
  });
}
