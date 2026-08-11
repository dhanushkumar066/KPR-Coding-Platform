import { Submission } from '../models/Submission.js';
import { runBatch } from './executor.js';
import {
  buildClassProgram,
  buildProgram,
  DEFAULT_TOLERANCE,
  diagnoseSolutionShape,
  needsTolerance,
} from './codegen/index.js';
import { outputsMatch, truncate } from '../utils/normalize.js';

/**
 * Deterministic, test-case-based grading (non-negotiable #3). No language model
 * is involved anywhere in this file.
 */

// Judge0 status ids.
const S = {
  ACCEPTED: 3,
  WRONG_ANSWER: 4,
  TLE: 5,
  COMPILE_ERROR: 6,
  INTERNAL_ERROR: 13,
  EXEC_FORMAT_ERROR: 14,
};

/** Maps an execution status to a per-case verdict, before output comparison. */
function verdictForStatus(statusId, statusDescription) {
  if (statusId === S.ACCEPTED) return null; // ran cleanly — compare output next
  if (statusId === S.TLE) return 'Time Limit Exceeded';
  if (statusId === S.COMPILE_ERROR) return 'Compile Error';
  if (statusId === S.WRONG_ANSWER) return 'Wrong Answer';
  if (statusId === S.INTERNAL_ERROR || statusId === S.EXEC_FORMAT_ERROR) return 'Judge Error';
  // Judge0 uses 7–12 for the various runtime-error signals.
  if (statusId >= 7 && statusId <= 12) return 'Runtime Error';
  return statusDescription ? 'Runtime Error' : 'Judge Error';
}

/** The submission-level verdict is the most severe thing that happened. */
function rollUpVerdict(caseVerdicts, allPassed, anyPassed) {
  if (caseVerdicts.includes('Compile Error')) return 'Compile Error';
  if (caseVerdicts.every((v) => v === 'Judge Error')) return 'Judge Error';
  if (allPassed) return 'Accepted';
  if (caseVerdicts.includes('Time Limit Exceeded') && !anyPassed) return 'Time Limit Exceeded';
  if (caseVerdicts.includes('Runtime Error') && !anyPassed) return 'Runtime Error';
  if (anyPassed) return 'Partially Accepted';
  if (caseVerdicts.includes('Time Limit Exceeded')) return 'Time Limit Exceeded';
  if (caseVerdicts.includes('Runtime Error')) return 'Runtime Error';
  return 'Wrong Answer';
}

/**
 * Runs `code` against `cases` and returns a scored result. Pure computation —
 * the caller decides what to persist.
 *
 * @param {object} params
 * @param {Array} params.cases  test-case subdocuments (input, expectedOutput, points, isSample)
 * @param {number} params.marks total marks the question is worth
 */
export async function evaluate({
  languageKey,
  code,
  cases,
  timeLimitSec,
  memoryLimitMb,
  marks,
  scored = true,
  functionSpec = null,
  // Set instead of functionSpec for a class ("design") question.
  classSpec = null,
  // How the answer is compared — see utils/normalize.js. Defaults to exact text.
  compare = null,
  /**
   * False when there is nothing to compare against — a student running their
   * own input. The case then "passes" if the program ran at all, so they see a
   * compile or runtime error but never a meaningless "Wrong Answer".
   */
  compareOutput = true,
}) {
  if (!cases.length) {
    return {
      verdict: 'Judge Error',
      results: [],
      passedCount: 0,
      totalCount: 0,
      score: 0,
      maxScore: scored ? marks : 0,
      maxTimeMs: 0,
      maxMemoryKb: 0,
      error: 'This question has no test cases',
    };
  }

  // In function and class mode the student wrote only part of a program, so
  // wrap it in the generated driver before anything is executed.
  let sourceCode = code;
  if (classSpec?.name || functionSpec?.name) {
    try {
      sourceCode = classSpec?.name
        ? buildClassProgram(classSpec, languageKey, code)
        : buildProgram(functionSpec, languageKey, code);
    } catch (err) {
      return {
        verdict: 'Judge Error',
        results: [],
        passedCount: 0,
        totalCount: cases.length,
        score: 0,
        maxScore: scored ? marks : 0,
        maxTimeMs: 0,
        maxMemoryKb: 0,
        error: err.message,
      };
    }
  }

  /**
   * A floating-point answer cannot be compared as text — the five languages
   * print it differently — so a `double` signature gets a tolerance whether or
   * not the teacher remembered to set one. Forgetting would otherwise fail
   * every student on a question that is perfectly well posed.
   */
  const effectiveCompare =
    needsTolerance(functionSpec) && !(compare?.tolerance > 0)
      ? { ...compare, tolerance: DEFAULT_TOLERANCE }
      : compare;

  const runs = await runBatch({
    languageKey,
    sourceCode,
    stdins: cases.map((c) => c.input ?? ''),
    timeLimitSec,
    memoryLimitMb,
  });

  const totalPoints = cases.reduce((sum, c) => sum + (c.points || 0), 0) || cases.length;
  const results = [];
  const caseVerdicts = [];
  let earnedPoints = 0;
  let passedCount = 0;
  let maxTimeMs = 0;
  let maxMemoryKb = 0;

  cases.forEach((testCase, i) => {
    const run = runs[i] || {
      statusId: S.INTERNAL_ERROR,
      statusDescription: 'No result returned',
      stdout: '',
      stderr: '',
      compileOutput: '',
      timeMs: 0,
      memoryKb: 0,
    };

    const statusVerdict = verdictForStatus(run.statusId, run.statusDescription);
    const points = testCase.points || 1;

    let passed = false;
    let verdict;
    if (statusVerdict) {
      verdict = statusVerdict;
    } else if (!compareOutput) {
      passed = true;
      verdict = 'Accepted';
    } else {
      // Output comparison uses our own normalization, never Judge0's.
      passed = outputsMatch(run.stdout, testCase.expectedOutput, effectiveCompare);
      verdict = passed ? 'Accepted' : 'Wrong Answer';
    }

    if (passed) {
      passedCount += 1;
      earnedPoints += points;
    }

    caseVerdicts.push(verdict);
    maxTimeMs = Math.max(maxTimeMs, run.timeMs || 0);
    maxMemoryKb = Math.max(maxMemoryKb, run.memoryKb || 0);

    results.push({
      caseId: testCase._id,
      index: i,
      isSample: Boolean(testCase.isSample),
      passed,
      verdict,
      points,
      // Partial scoring: each case earns its own weight.
      earned: passed && scored ? (points / totalPoints) * marks : 0,
      timeMs: run.timeMs || 0,
      memoryKb: run.memoryKb || 0,
      stdout: truncate(run.stdout),
      stderr: truncate(run.stderr, 2000),
      compileOutput: truncate(run.compileOutput, 2000),
    });
  });

  const allPassed = passedCount === cases.length;
  const rawScore = scored ? (earnedPoints / totalPoints) * marks : 0;
  const verdict = rollUpVerdict(caseVerdicts, allPassed, passedCount > 0);

  /*
   * A compiler message about a duplicate class says nothing about what the
   * person actually did wrong — which is usually that they wrote a whole
   * program in a mode where the platform supplies everything but the answer.
   * The hint goes alongside the real output, never instead of it.
   */
  // Compile *and* runtime failures: Python has no compile step, so wrongly
  // shaped code there surfaces as a NameError instead. The diagnoser only
  // speaks up for genuine shape problems, so an ordinary runtime bug — an index
  // out of range — still returns nothing.
  const shapeMayBeWrong = verdict === 'Compile Error' || verdict === 'Runtime Error';
  const hint =
    shapeMayBeWrong && (functionSpec?.name || classSpec?.name)
      ? diagnoseSolutionShape(
          code,
          languageKey,
          classSpec?.name ? classSpec : functionSpec,
          classSpec?.name ? 'class' : 'function'
        )
      : null;

  return {
    verdict,
    hint,
    results,
    passedCount,
    totalCount: cases.length,
    // Two decimals keeps partial marks readable (e.g. 6.67 / 10).
    score: Math.round(rawScore * 100) / 100,
    maxScore: scored ? marks : 0,
    maxTimeMs,
    maxMemoryKb,
    error: '',
  };
}

/**
 * Grades an already-persisted submission and writes the outcome back.
 *
 * The Submission row is created by the caller *before* this runs
 * (non-negotiable #4), so a judge outage leaves a recoverable `error` row
 * rather than losing the student's code.
 */
export async function gradeSubmission(submissionId, question, { scored = true } = {}) {
  const submission = await Submission.findById(submissionId);
  if (!submission) throw new Error('Submission disappeared before grading');

  // A student running their own input replaces the sample cases with that one
  // input, and has nothing to be marked against.
  const isCustomRun = submission.kind === 'run' && Boolean(submission.customInput);

  const cases = isCustomRun
    ? [{ input: submission.customInput, expectedOutput: '', points: 0, isSample: true }]
    : submission.kind === 'run'
      ? question.testCases.filter((c) => c.isSample)
      : question.testCases;

  try {
    const outcome = await evaluate({
      languageKey: submission.language,
      code: submission.code,
      cases,
      compareOutput: !isCustomRun,
      timeLimitSec: question.timeLimitSec,
      memoryLimitMb: question.memoryLimitMb,
      marks: question.marks,
      scored,
      functionSpec: question.ioMode === 'function' ? question.functionSpec : null,
      classSpec: question.ioMode === 'class' ? question.classSpec : null,
      compare: question.answerCompare,
    });

    submission.set({
      status: outcome.error ? 'error' : 'graded',
      verdict: outcome.verdict,
      results: outcome.results,
      passedCount: outcome.passedCount,
      totalCount: outcome.totalCount,
      score: outcome.score,
      maxScore: outcome.maxScore,
      maxTimeMs: outcome.maxTimeMs,
      maxMemoryKb: outcome.maxMemoryKb,
      error: outcome.error,
      hint: outcome.hint || '',
      gradedAt: new Date(),
    });
    await submission.save();
    return submission;
  } catch (err) {
    // The judge failed, not the student. Keep the code, flag it for retry, and
    // never silently award zero.
    console.error('[grader] execution failed', err);
    submission.set({
      status: 'error',
      verdict: 'Judge Error',
      error: err.message || 'The judge could not run this submission',
      gradedAt: new Date(),
    });
    await submission.save();
    return submission;
  }
}
