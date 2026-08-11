/**
 * Numerical Answer Type — GATE's third question type.
 *
 * The student types a number instead of choosing an option. GATE publishes its
 * answers as a *range* ("2.4 to 2.6") rather than a single value, because a
 * question involving division has no one right decimal expansion — so a range
 * is what this stores, with an exact answer expressed as a range of zero width.
 *
 * GATE applies **no negative marking** to NAT, and this follows that: there is
 * nothing to guess between, so a wrong number is simply worth nothing.
 *
 * Deterministic and key-based, like every other grader here — no language model
 * is anywhere near a score (non-negotiable #3).
 */

/**
 * Reads what the student typed.
 *
 * Deliberately tolerant of the ways a number gets written under time pressure —
 * a stray space, a leading `+`, a comma as a thousands separator — because none
 * of those are the thing being examined. Anything genuinely not a number is
 * rejected rather than coerced: `Number('')` is 0, and marking a blank answer
 * as the value zero would be badly wrong.
 */
export function parseNatAnswer(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const cleaned = text.replace(/,/g, '').replace(/^\+/, '');
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {object} question a Question document with kind === 'nat'
 * @param {string} raw what the student typed
 */
export function gradeNat(question, raw) {
  const marks = question.marks || 0;
  const { answerMin, answerMax } = question.nat || {};

  const value = parseNatAnswer(raw);

  if (value === null) {
    // Blank and unreadable are the same thing here: nothing was answered.
    // Never negative — GATE does not penalise NAT, and neither do we.
    return { score: 0, verdict: 'Unanswered', value: null, accepted: null };
  }

  const lo = Math.min(Number(answerMin), Number(answerMax));
  const hi = Math.max(Number(answerMin), Number(answerMax));

  // A tiny epsilon so a boundary answer is not lost to floating-point noise —
  // 2.4 typed against a range ending at 2.4 must count.
  const epsilon = 1e-9;
  const correct = value >= lo - epsilon && value <= hi + epsilon;

  return {
    score: correct ? marks : 0,
    verdict: correct ? 'Correct' : 'Incorrect',
    value,
    accepted: { min: lo, max: hi },
  };
}

/** The answer key, for review once the attempt is over. */
export function natReview(question, raw) {
  const { answerMin, answerMax } = question.nat || {};
  const lo = Math.min(Number(answerMin), Number(answerMax));
  const hi = Math.max(Number(answerMin), Number(answerMax));
  return {
    given: String(raw ?? ''),
    value: parseNatAnswer(raw),
    accepted: { min: lo, max: hi },
    exact: lo === hi,
    unit: question.nat?.unit || '',
  };
}
