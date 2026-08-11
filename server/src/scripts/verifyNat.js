/**
 * Numerical Answer Type grading — GATE's third question type.
 *
 *   npm run verify:nat
 */
import { gradeNat, parseNatAnswer } from '../services/natGrader.js';

const q = (marks, answerMin, answerMax) => ({ marks, kind: 'nat', nat: { answerMin, answerMax } });

const CASES = [
  // --- an exact answer (a range of zero width) --------------------------
  ['exact, correct', q(2, 42, 42), '42', 2, 'Correct'],
  ['exact, wrong', q(2, 42, 42), '41', 0, 'Incorrect'],
  ['exact, decimal form of the same number', q(2, 42, 42), '42.0', 2, 'Correct'],

  // --- a published range, as GATE writes them ---------------------------
  ['range, inside', q(2, 2.4, 2.6), '2.5', 2, 'Correct'],
  ['range, on the lower boundary', q(2, 2.4, 2.6), '2.4', 2, 'Correct'],
  ['range, on the upper boundary', q(2, 2.4, 2.6), '2.6', 2, 'Correct'],
  ['range, just outside', q(2, 2.4, 2.6), '2.61', 0, 'Incorrect'],
  ['range entered backwards still works', q(2, 2.6, 2.4), '2.5', 2, 'Correct'],

  // --- never negative, whatever happens ---------------------------------
  ['blank', q(2, 42, 42), '', 0, 'Unanswered'],
  ['whitespace only', q(2, 42, 42), '   ', 0, 'Unanswered'],
  ['not a number', q(2, 42, 42), 'forty two', 0, 'Unanswered'],
  ['wildly wrong', q(2, 42, 42), '-99999', 0, 'Incorrect'],

  // --- the ways people actually type numbers ----------------------------
  ['leading and trailing spaces', q(1, 7, 7), '  7  ', 1, 'Correct'],
  ['leading plus', q(1, 7, 7), '+7', 1, 'Correct'],
  ['thousands separator', q(1, 1000, 1000), '1,000', 1, 'Correct'],
  ['negative answer', q(1, -3.5, -3.5), '-3.5', 1, 'Correct'],
  ['scientific notation', q(1, 1500, 1500), '1.5e3', 1, 'Correct'],
  ['no leading zero', q(1, 0.5, 0.5), '.5', 1, 'Correct'],
];

let pass = 0;
let fail = 0;

for (const [label, question, given, wantScore, wantVerdict] of CASES) {
  const got = gradeNat(question, given);
  const ok = got.score === wantScore && got.verdict === wantVerdict;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(38)} ${JSON.stringify(given).padEnd(12)} -> ${
      got.verdict
    } ${got.score}/${question.marks}${ok ? '' : `  (wanted ${wantVerdict} ${wantScore})`}`
  );
}

// A blank answer must never be read as the number zero — a question whose
// answer genuinely is 0 would otherwise mark every empty box correct.
const zeroQ = q(1, 0, 0);
const blankOnZero = gradeNat(zeroQ, '');
const zeroOnZero = gradeNat(zeroQ, '0');
const zeroOk = blankOnZero.verdict === 'Unanswered' && zeroOnZero.verdict === 'Correct';
zeroOk ? pass++ : fail++;
console.log(
  `\n  ${zeroOk ? 'PASS' : 'FAIL'}  a blank answer is not the number zero: ` +
    `blank -> ${blankOnZero.verdict}, "0" -> ${zeroOnZero.verdict}`
);

// And nothing here can ever return a negative score.
const negative = CASES.some(([, question, given]) => gradeNat(question, given).score < 0);
!negative ? pass++ : fail++;
console.log(`  ${!negative ? 'PASS' : 'FAIL'}  no NAT answer is ever negatively marked`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
