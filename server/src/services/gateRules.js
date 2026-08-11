/**
 * GATE's paper conventions, in one place.
 *
 * These are the rules the exam actually publishes, so a teacher choosing the
 * GATE workspace gets a GATE paper without having to remember any of it. Every
 * value here is a *default* applied at authoring time — a teacher may still
 * override any of it on an individual question.
 */

/** GATE's standard section split: 15 marks of aptitude, 85 of the subject. */
export const GATE_SECTIONS = {
  aptitude: 'General Aptitude',
  core: 'Core Subject',
};

export const GATE_SECTION_NAMES = Object.values(GATE_SECTIONS);

/** GATE only ever asks 1-mark and 2-mark questions. */
export const GATE_MARKS = [1, 2];

/**
 * The negative marking, by question type.
 *
 * MCQ: a third of the question's own marks — 1/3 off a 1-mark question, 2/3 off
 * a 2-mark one. Storing the fraction rather than a flat deduction is what keeps
 * it proportionate across a paper that mixes both weights.
 *
 * MSQ and NAT: nothing. This is the rule candidates most often get wrong, and
 * getting it wrong in the other direction — deducting where GATE does not —
 * would take marks off a student who answered exactly as the real exam invites.
 */
export const GATE_NEGATIVE_FRACTION = 1 / 3;

/** Is this question type negatively marked under GATE's rules? */
export function gateHasNegative({ kind, multiSelect }) {
  return kind === 'mcq' && !multiSelect;
}

/**
 * Fill in GATE's conventions on a question being saved into the GATE workspace.
 *
 * Only ever *adds* what the teacher did not specify, except for the two rules
 * GATE states absolutely: MSQ and NAT carry no negative marking, so those are
 * forced to zero rather than defaulted. A teacher who wants a deduction there
 * is not writing a GATE paper.
 */
export function applyGateDefaults(doc) {
  if (doc.style !== 'gate') return doc;

  if (!doc.section) doc.section = GATE_SECTIONS.core;

  if (doc.kind === 'nat') {
    // NAT is never negatively marked.
    doc.nat = doc.nat || {};
    return doc;
  }

  if (doc.kind === 'mcq') {
    doc.mcq = doc.mcq || {};
    if (doc.mcq.multiSelect) {
      // MSQ: no negative marking, and no partial credit either — GATE awards
      // an MSQ only when every correct option is chosen and no wrong one is.
      doc.mcq.negativeFraction = 0;
      doc.mcq.negativeMarks = 0;
      doc.mcq.partialCredit = false;
    } else if (
      doc.mcq.negativeFraction === undefined ||
      doc.mcq.negativeFraction === null ||
      doc.mcq.negativeFraction === 0
    ) {
      // Single-answer MCQ: a third off, unless the teacher set something.
      if (!doc.mcq.negativeMarks) doc.mcq.negativeFraction = GATE_NEGATIVE_FRACTION;
    }
  }

  return doc;
}

/**
 * What a GATE paper should look like, checked against the real exam's shape.
 * Returned as advice for the teacher — never enforced, because a mock paper or
 * a single-topic practice set is a legitimate thing to build.
 */
export function gatePaperAdvice(questions) {
  const notes = [];
  const gate = questions.filter((q) => q.style === 'gate');
  if (!gate.length) return notes;

  const total = gate.reduce((sum, q) => sum + (q.marks || 0), 0);
  const aptitude = gate
    .filter((q) => q.section === GATE_SECTIONS.aptitude)
    .reduce((sum, q) => sum + (q.marks || 0), 0);

  if (total !== 100) {
    notes.push(`This paper is ${total} marks. A full GATE paper is 100.`);
  }
  if (aptitude !== 15) {
    notes.push(`General Aptitude is ${aptitude} marks here. GATE always allots 15.`);
  }
  const oddWeights = gate.filter((q) => !GATE_MARKS.includes(q.marks));
  if (oddWeights.length) {
    notes.push(
      `${oddWeights.length} question${oddWeights.length > 1 ? 's are' : ' is'} not worth 1 or 2 marks. GATE only uses those two weights.`
    );
  }
  return notes;
}
