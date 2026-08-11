/**
 * Test-case input written the way LeetCode displays it.
 *
 * Teachers copy `nums = [2,7,11,15], target = 9` because that is what a problem
 * looks like on the site. This is the layer that accepts it, so it is worth
 * testing against the shapes people actually type.
 *
 *   npm run verify:caseinput
 */
import { normaliseCaseInput, labelCaseInput } from '../services/codegen/normaliseCase.js';

const twoArgs = {
  name: 'addTwoNumbers',
  params: [
    { name: 'a', type: 'int' },
    { name: 'b', type: 'int' },
  ],
};

const twoSum = {
  name: 'twoSum',
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
};

const oneString = { name: 'solve', params: [{ name: 's', type: 'string' }] };

const CASES = [
  // --- the form that prompted all this -----------------------------------
  ['labelled, one per line', twoArgs, 'a = 10\nb = 20', '10\n20'],
  ['labelled, no spaces', twoArgs, 'a=10\nb=20', '10\n20'],
  ['labelled, one line', twoArgs, 'a = 10, b = 20', '10\n20'],

  // --- LeetCode's own display format -------------------------------------
  [
    'commas inside the array survive',
    twoSum,
    'nums = [2,7,11,15], target = 9',
    '[2,7,11,15]\n9',
  ],
  [
    'labelled across two lines',
    twoSum,
    'nums = [2,7,11,15]\ntarget = 9',
    '[2,7,11,15]\n9',
  ],
  ['written out of order', twoSum, 'target = 9, nums = [2,7,11,15]', '[2,7,11,15]\n9'],

  // --- the raw form still works untouched --------------------------------
  ['raw values are left alone', twoArgs, '10\n20', '10\n20'],
  ['raw array and scalar', twoSum, '[2,7,11,15]\n9', '[2,7,11,15]\n9'],

  // --- an "=" inside a value must not be mistaken for a label ------------
  ['equals inside a string', oneString, '"a=b"', '"a=b"'],
  ['labelled string containing equals', oneString, 's = "a=b"', '"a=b"'],

  // --- 2-D data ----------------------------------------------------------
  [
    'nested arrays',
    { name: 'f', params: [{ name: 'grid', type: 'int[][]' }] },
    'grid = [[1,2],[3,4]]',
    '[[1,2],[3,4]]',
  ],
];

let pass = 0;
let fail = 0;

for (const [label, spec, raw, want] of CASES) {
  const got = normaliseCaseInput(spec, raw);
  const ok = got.ok && got.input === want;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${JSON.stringify(raw)} -> ${
      got.ok ? JSON.stringify(got.input) : `ERROR ${got.error}`
    }${ok ? '' : `  (wanted ${JSON.stringify(want)})`}`
  );
}

// Labelling half the arguments is ambiguous and must be reported, not guessed.
const partial = normaliseCaseInput(twoSum, 'nums = [2,7,11,15]\n9');
const partialOk = !partial.ok && /target/.test(partial.error);
partialOk ? pass++ : fail++;
console.log(
  `\n  ${partialOk ? 'PASS' : 'FAIL'}  half-labelled input is rejected: ${
    partial.ok ? 'accepted!' : partial.error.slice(0, 70)
  }`
);

// --- and the display direction ------------------------------------------
console.log('\n  Showing a case back to a student');
const DISPLAY = [
  [twoSum, '[2,7,11,15]\n9', 'nums = [2,7,11,15], target = 9'],
  [twoArgs, '10\n20', 'a = 10, b = 20'],
];
for (const [spec, canonical, want] of DISPLAY) {
  const got = labelCaseInput(spec, canonical);
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(canonical)} -> ${got}`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
