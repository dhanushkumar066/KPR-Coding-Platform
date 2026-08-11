/**
 * What GATE awards for a question, by type and weight.
 *
 * These are the rules the exam itself publishes and has used for years:
 *
 *   MCQ  one correct answer out of four.
 *        Right: full marks. Wrong: a THIRD of the question's own marks is
 *        deducted — 1/3 off a 1-mark question, 2/3 off a 2-mark one.
 *
 *   MSQ  one or more correct. No negative marking at all, and no partial
 *        credit: every correct option and no wrong one, or nothing.
 *
 *   NAT  the candidate types a number. No negative marking, no partial credit.
 *
 *   Unattempted is always zero — GATE penalises a wrong answer, never silence.
 *
 * The numbers here are what the teacher is shown while writing the paper, so
 * they must be exactly what the judge later awards. `npm run verify:gate` runs
 * the real graders against these figures to prove they have not drifted apart;
 * telling a teacher one deduction and applying another would be worse than
 * having no display at all.
 */

/** GATE deducts a third of an MCQ's own marks. Kept as the fraction itself. */
export const GATE_NEGATIVE_FRACTION = 1 / 3;

/**
 * The exact deduction — a true third, not a rounded one.
 *
 * GATE applies exactly 1/3 and 2/3 and rounds only the final total. Rounding
 * here would put the display out of step with the judge and, worse, suggest the
 * deduction really is 0.33 when three of them cost a whole mark.
 */
export function gatePenalty(type, marks) {
  if (type !== 'mcq') return 0;
  return Number(marks || 0) * GATE_NEGATIVE_FRACTION;
}

/** How GATE itself writes the deduction: "1/3" off a 1-mark question. */
export function gatePenaltyLabel(marks) {
  return `${Number(marks || 0)}/3`;
}

/** Two decimals, for putting a number next to the fraction. */
const dp2 = (n) => Math.round(n * 100) / 100;

/**
 * The full marking for one question.
 * @returns {{correct:number, wrong:number, unattempted:number, summary:string, detail:string}}
 */
export function gateMarking(type, marks) {
  const m = Number(marks || 0);
  const wrong = gatePenalty(type, m);

  if (type === 'mcq') {
    const label = gatePenaltyLabel(m);
    return {
      correct: m,
      wrong: -wrong,
      unattempted: 0,
      // Shown as the fraction GATE publishes, with the decimal beside it — the
      // deduction is a true third, and three of them cost a whole mark.
      wrongLabel: `−${label}`,
      wrongApprox: dp2(wrong),
      summary: `+${m} correct · −${label} wrong · 0 unattempted`,
      detail: `GATE deducts a third of a question's own marks for a wrong MCQ — ${label} here, about ${dp2(wrong)}. Three of these cost a whole mark.`,
    };
  }

  if (type === 'msq') {
    return {
      correct: m,
      wrong: 0,
      unattempted: 0,
      wrongLabel: '0',
      wrongApprox: 0,
      summary: `+${m} only if every correct option is ticked · 0 otherwise`,
      detail:
        'GATE never deducts for an MSQ, and never gives part marks: all the correct options and none of the wrong ones, or nothing.',
    };
  }

  // NAT
  return {
    correct: m,
    wrong: 0,
    unattempted: 0,
    wrongLabel: '0',
    wrongApprox: 0,
    summary: `+${m} correct · 0 wrong · 0 unattempted`,
    detail: 'GATE never deducts for a numerical answer.',
  };
}

/**
 * The marking fields to store on the question, so the saved document says the
 * same thing the screen did rather than relying on a default filling it in.
 */
export function gateMarkingFields(type) {
  if (type === 'mcq') {
    return { negativeFraction: GATE_NEGATIVE_FRACTION, negativeMarks: 0, partialCredit: false };
  }
  // MSQ and NAT: nothing is ever deducted, and an MSQ is all-or-nothing.
  return { negativeFraction: 0, negativeMarks: 0, partialCredit: false };
}
