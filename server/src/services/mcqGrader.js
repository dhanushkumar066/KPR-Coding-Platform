/**
 * MCQ grading. Deterministic and key-based, exactly like the coding grader —
 * no language model is anywhere near a score (non-negotiable #3).
 */

/**
 * What a wrong answer costs, in marks.
 *
 * GATE expresses its deduction as a *fraction of the question's own marks* —
 * a 1-mark question loses 1/3, a 2-mark question loses 2/3 — so a paper mixing
 * 1- and 2-mark questions stays proportionate without the setter doing
 * arithmetic per question. A flat figure is kept for papers that want one.
 *
 * The fraction wins when both are set, because it is the more specific
 * instruction.
 */
export function penaltyFor(question) {
  const marks = question.marks || 0;
  const fraction = question.mcq?.negativeFraction || 0;
  // Deliberately NOT rounded here.
  //
  // GATE deducts exactly a third — 1/3 off a 1-mark question, 2/3 off a 2-mark
  // one — and only the final total is reported to two decimals. Rounding each
  // deduction first compounds: three wrong 1-mark questions should cost exactly
  // 1.00 but a rounded 0.33 charges 0.99, and twelve wrong 2-mark questions
  // over-charge by 0.04. Ranks turn on hundredths, so the arithmetic stays
  // exact all the way to the attempt total, which is where rounding belongs.
  if (fraction > 0) return marks * fraction;
  return question.mcq?.negativeMarks || 0;
}

/** Two decimals, for showing a score to a person. Never used in arithmetic. */
export function displayScore(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {object} question  a Question document with kind === 'mcq'
 * @param {string[]} selectedIds  option ids the student chose
 */
export function gradeMcq(question, selectedIds = []) {
  const options = question.mcq.options;
  const correctIds = new Set(
    options.filter((o) => o.isCorrect).map((o) => o._id.toString())
  );
  const validIds = new Set(options.map((o) => o._id.toString()));

  // Ignore anything that is not an option of this question.
  const chosen = new Set(selectedIds.map(String).filter((id) => validIds.has(id)));

  const hits = [...chosen].filter((id) => correctIds.has(id)).length;
  const misses = chosen.size - hits;
  const marks = question.marks;
  const penalty = penaltyFor(question);

  if (!chosen.size) {
    // Unanswered is never penalised — negative marking is for a wrong answer,
    // not for leaving a question alone.
    return {
      score: 0,
      verdict: 'Unanswered',
      correctCount: correctIds.size,
      selectedCount: 0,
      hits: 0,
      misses: 0,
    };
  }

  let score;
  let verdict;

  if (!question.mcq.multiSelect) {
    const right = hits === 1 && chosen.size === 1;
    score = right ? marks : -penalty;
    verdict = right ? 'Correct' : 'Incorrect';
  } else if (question.mcq.partialCredit) {
    const raw = correctIds.size ? (hits - misses) / correctIds.size : 0;
    score = Math.max(0, raw) * marks;
    const perfect = hits === correctIds.size && misses === 0;
    verdict = perfect ? 'Correct' : score > 0 ? 'Partially Correct' : 'Incorrect';
    // A wholly wrong multi-select answer still attracts the penalty.
    if (score === 0 && penalty) score = -penalty;
  } else {
    const exact = hits === correctIds.size && misses === 0;
    score = exact ? marks : -penalty;
    verdict = exact ? 'Correct' : 'Incorrect';
  }

  return {
    // Exact, for the same reason penaltyFor is exact — the attempt total does
    // the rounding, once, at the end.
    score,
    verdict,
    correctCount: correctIds.size,
    selectedCount: chosen.size,
    hits,
    misses,
  };
}

/** The answer key, for review after the attempt has finished. */
export function mcqReview(question, selectedIds = []) {
  const chosen = new Set(selectedIds.map(String));
  return question.mcq.options.map((o) => ({
    id: o._id.toString(),
    text: o.text,
    isCorrect: o.isCorrect,
    selected: chosen.has(o._id.toString()),
    explanation: o.explanation,
  }));
}
