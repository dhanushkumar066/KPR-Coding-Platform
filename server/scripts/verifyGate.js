/**
 * GATE's marking conventions.
 *
 * The rule worth pinning down is the negative one, in both directions:
 *   - a single-answer MCQ must lose a third of its own marks, and
 *   - an MSQ or a NAT must lose nothing at all.
 *
 * The second is the dangerous one. Deducting where GATE does not takes marks
 * off a student who answered exactly as the real exam invites them to, and it
 * would do it silently — the paper would still look right.
 *
 * Run: npm run verify:gate
 */
import {
  applyGateDefaults,
  gateHasNegative,
  gatePaperAdvice,
  GATE_NEGATIVE_FRACTION,
  GATE_SECTIONS,
} from '../src/services/gateRules.js';
import { penaltyFor } from '../src/services/mcqGrader.js';

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
  }
}

const gate = (over = {}) => applyGateDefaults({ style: 'gate', kind: 'mcq', mcq: {}, ...over });

console.log('\nGATE deducts on a single-answer MCQ');
check('a third by default', gate().mcq.negativeFraction, GATE_NEGATIVE_FRACTION);
check('1-mark question loses exactly 1/3', penaltyFor({ marks: 1, mcq: gate().mcq }), 1 / 3);
check('2-mark question loses exactly 2/3', penaltyFor({ marks: 2, mcq: gate().mcq }), 2 / 3);
check(
  'a teacher-set fraction is left alone',
  gate({ mcq: { negativeFraction: 0.25 } }).mcq.negativeFraction,
  0.25
);
check(
  'a teacher-set flat deduction is not overridden by the fraction',
  gate({ mcq: { negativeMarks: 0.5 } }).mcq.negativeFraction,
  undefined
);

console.log('\nGATE never deducts on MSQ or NAT');
check('MSQ fraction forced to zero', gate({ mcq: { multiSelect: true } }).mcq.negativeFraction, 0);
check('MSQ flat deduction forced to zero', gate({ mcq: { multiSelect: true } }).mcq.negativeMarks, 0);
check(
  'MSQ costs nothing even when a teacher set a deduction',
  penaltyFor({ marks: 2, mcq: gate({ mcq: { multiSelect: true, negativeFraction: 0.5, negativeMarks: 1 } }).mcq }),
  0
);
check('MSQ has no partial credit', gate({ mcq: { multiSelect: true } }).mcq.partialCredit, false);
check(
  'NAT is untouched by the MCQ rules',
  gate({ kind: 'nat', mcq: undefined }).mcq,
  undefined
);
check('helper agrees: single MCQ is negative', gateHasNegative({ kind: 'mcq', multiSelect: false }), true);
check('helper agrees: MSQ is not', gateHasNegative({ kind: 'mcq', multiSelect: true }), false);
check('helper agrees: NAT is not', gateHasNegative({ kind: 'nat' }), false);
check('helper agrees: coding is not', gateHasNegative({ kind: 'coding' }), false);

console.log('\nSections');
check('defaults to the core subject', gate().section, GATE_SECTIONS.core);
check(
  'a chosen section is kept',
  gate({ section: GATE_SECTIONS.aptitude }).section,
  GATE_SECTIONS.aptitude
);
check('a custom section name is kept', gate({ section: 'Engineering Maths' }).section, 'Engineering Maths');

console.log('\nStandard questions are never touched');
const standard = applyGateDefaults({ style: 'standard', kind: 'mcq', mcq: {} });
check('no deduction added', standard.mcq.negativeFraction, undefined);
check('no section added', standard.section, undefined);

console.log('\nPaper advice (guidance only, never enforced)');
const full = [
  { style: 'gate', marks: 1, section: GATE_SECTIONS.aptitude },
  ...Array.from({ length: 7 }, () => ({ style: 'gate', marks: 2, section: GATE_SECTIONS.aptitude })),
  ...Array.from({ length: 85 }, () => ({ style: 'gate', marks: 1, section: GATE_SECTIONS.core })),
];
check('a correct 100-mark paper draws no complaints', gatePaperAdvice(full), []);
check('an empty library says nothing', gatePaperAdvice([]), []);
check(
  'a short paper is flagged',
  gatePaperAdvice([{ style: 'gate', marks: 2, section: GATE_SECTIONS.core }]).length > 0,
  true
);
check(
  'an odd weight is flagged',
  gatePaperAdvice([{ style: 'gate', marks: 5, section: GATE_SECTIONS.core }]).some((n) =>
    n.includes('1 or 2 marks')
  ),
  true
);
check(
  'standard questions are ignored by the advice',
  gatePaperAdvice([{ style: 'standard', marks: 999 }]),
  []
);

// ---------------------------------------------------------------------------
// The teacher is told the truth
// ---------------------------------------------------------------------------
//
// The builder prints the marking on every question as it is written. That
// display and the judge must agree exactly: telling a teacher "−0.67 if wrong"
// and then deducting something else would corrupt a paper silently, and the
// teacher would have no reason to look. So run the REAL graders and compare.

const { gateMarking } = await import('../../client/src/lib/gateMarking.js');
const { gradeMcq } = await import('../src/services/mcqGrader.js');
const { gradeNat } = await import('../src/services/natGrader.js');

/** A question document shaped the way the builder saves one. */
function builtQuestion(type, marks) {
  const base = applyGateDefaults({
    style: 'gate',
    kind: type === 'nat' ? 'nat' : 'mcq',
    marks,
    ...(type === 'nat'
      ? { nat: { answerMin: 5, answerMax: 5, unit: '' } }
      : {
          mcq: {
            multiSelect: type === 'msq',
            options: [
              { _id: 'a', text: 'A', isCorrect: true },
              { _id: 'b', text: 'B', isCorrect: type === 'msq' },
              { _id: 'c', text: 'C', isCorrect: false },
              { _id: 'd', text: 'D', isCorrect: false },
            ],
          },
        }),
  });
  return base;
}

const rightAnswer = { mcq: ['a'], msq: ['a', 'b'], nat: '5' };
const wrongAnswer = { mcq: ['c'], msq: ['c'], nat: '99' };

console.log('\nWhat the builder shows is what the judge awards');
for (const type of ['mcq', 'msq', 'nat']) {
  for (const marks of [1, 2]) {
    const q = builtQuestion(type, marks);
    const shown = gateMarking(type, marks);
    const score = (ans) =>
      type === 'nat' ? gradeNat(q, ans).score : gradeMcq(q, ans).score;

    check(`${type} ${marks}m — correct`, score(rightAnswer[type]), shown.correct);
    check(`${type} ${marks}m — wrong`, score(wrongAnswer[type]), shown.wrong);
    check(
      `${type} ${marks}m — unattempted`,
      score(type === 'nat' ? '' : []),
      shown.unattempted
    );
  }
}

// ---------------------------------------------------------------------------
// The deduction is a true third, not a rounded one
// ---------------------------------------------------------------------------
//
// GATE takes exactly 1/3 off a 1-mark question and 2/3 off a 2-mark one, and
// rounds only the reported total. Rounding each deduction to 0.33 first looks
// harmless on one question and is wrong by the third: three wrong 1-mark
// questions must cost exactly 1.00, not 0.99. These check the arithmetic at the
// scale a real paper reaches.

console.log('\nDeductions stay exact until the total');
check('a 1-mark MCQ deducts a true third', penaltyFor(gate({ marks: 1 })), 1 / 3);
check('a 2-mark MCQ deducts a true two-thirds', penaltyFor(gate({ marks: 2 })), 2 / 3);

const wrongRun = (n, marks) => {
  const q = builtQuestion('mcq', marks);
  let total = 0;
  for (let i = 0; i < n; i += 1) total += gradeMcq(q, ['c']).score;
  return Math.round(total * 100) / 100;
};
check('3 wrong 1-mark MCQs cost exactly 1', wrongRun(3, 1), -1);
check('6 wrong 1-mark MCQs cost exactly 2', wrongRun(6, 1), -2);
check('15 wrong 1-mark MCQs cost exactly 5', wrongRun(15, 1), -5);
check('3 wrong 2-mark MCQs cost exactly 2', wrongRun(3, 2), -2);
check('9 wrong 2-mark MCQs cost exactly 6', wrongRun(9, 2), -6);
check('12 wrong 2-mark MCQs cost exactly 8', wrongRun(12, 2), -8);

// A whole GATE paper answered wrongly: 30 one-mark and 25 two-mark questions.
const wholePaper =
  30 * gradeMcq(builtQuestion('mcq', 1), ['c']).score +
  25 * gradeMcq(builtQuestion('mcq', 2), ['c']).score;
check(
  'a whole paper wrong matches GATE to the paisa',
  Math.round(wholePaper * 100) / 100,
  Math.round((-(30 * (1 / 3)) - 25 * (2 / 3)) * 100) / 100
);

console.log('\nGATE’s specific figures');
check('a wrong 1-mark MCQ costs a true third', gateMarking('mcq', 1).wrong, -(1 / 3));
check('a wrong 2-mark MCQ costs a true two-thirds', gateMarking('mcq', 2).wrong, -(2 / 3));
check('and is shown the way GATE writes it', gateMarking('mcq', 2).wrongLabel, '−2/3');
check('with the decimal only as a hint', gateMarking('mcq', 2).wrongApprox, 0.67);
check('a wrong MSQ costs nothing', gateMarking('msq', 2).wrong, 0);
check('a wrong NAT costs nothing', gateMarking('nat', 2).wrong, 0);
check(
  'a half-right MSQ earns nothing — GATE gives no part marks',
  gradeMcq(builtQuestion('msq', 2), ['a']).score,
  0
);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
