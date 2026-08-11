/**
 * The answer-comparison rules, in isolation.
 *
 * These decide whether a student is marked right or wrong, so they are worth
 * testing directly rather than only through a language round trip. Every case
 * below is a real shape a question can produce.
 *
 *   npm run verify:compare
 */
import { outputsMatch } from '../utils/normalize.js';

const EXACT = {};
const UNORDERED = { ignoreOrder: true };
const DEEP = { ignoreOrder: true, ignoreInnerOrder: true };
const TOL = { tolerance: 1e-6 };

const CASES = [
  // --- exact text stays exact -------------------------------------------
  ['exact: identical', '[0,1]', '[0,1]', EXACT, true],
  ['exact: different order is wrong', '[1,0]', '[0,1]', EXACT, false],
  ['exact: trailing newline forgiven', '[0,1]\n', '[0,1]', EXACT, true],
  ['exact: trailing spaces forgiven', '42   ', '42', EXACT, true],

  // --- ignoreOrder: the answer is a set ---------------------------------
  ['unordered: reordered elements', '[3,1,2]', '[1,2,3]', UNORDERED, true],
  ['unordered: missing element', '[1,2]', '[1,2,3]', UNORDERED, false],
  ['unordered: duplicate is not a set', '[1,1,2]', '[1,2,2]', UNORDERED, false],
  [
    'unordered: Group Anagrams, groups reordered',
    '[["tan","nat"],["bat"]]',
    '[["bat"],["tan","nat"]]',
    UNORDERED,
    true,
  ],
  [
    'unordered: inner order still matters without the deep flag',
    '[["nat","tan"],["bat"]]',
    '[["tan","nat"],["bat"]]',
    UNORDERED,
    false,
  ],

  // --- ignoreInnerOrder: elements are sets too ---------------------------
  [
    'deep: 3Sum, triplets and their contents reordered',
    '[[0,-1,1],[2,-1,-1]]',
    '[[-1,-1,2],[-1,0,1]]',
    DEEP,
    true,
  ],
  ['deep: wrong triplet still fails', '[[0,-1,1],[2,-1,0]]', '[[-1,-1,2],[-1,0,1]]', DEEP, false],

  // --- tolerance ---------------------------------------------------------
  ['tolerance: within', '2.0000001', '2.0', TOL, true],
  ['tolerance: outside', '2.01', '2.0', TOL, false],
  ['tolerance: inside an array', '[1.0000001,2.5]', '[1.0,2.5]', TOL, true],
  ['tolerance: off by default', '2.0000001', '2.0', EXACT, false],
  ['tolerance: large magnitudes compare relatively', '1000000000.5', '1000000000.0', TOL, true],

  // --- non-JSON answers fall back to lines -------------------------------
  ['lines: unordered text lines', 'banana\napple', 'apple\nbanana', UNORDERED, true],
  ['lines: unordered but a line differs', 'banana\ncherry', 'apple\nbanana', UNORDERED, false],
  ['lines: count must still match', 'apple', 'apple\nbanana', UNORDERED, false],

  // --- malformed output is never accidentally accepted -------------------
  ['garbage is not equal to an array', 'not json', '[1,2]', DEEP, false],
  ['empty output fails a real answer', '', '[1,2]', DEEP, false],
  ['type mismatch fails', '[[1,2]]', '[1,2]', DEEP, false],
  ['length mismatch fails', '[1,2,3]', '[1,2]', DEEP, false],
];

let pass = 0;
let fail = 0;

for (const [label, actual, expected, options, want] of CASES) {
  const got = outputsMatch(actual, expected, options);
  const ok = got === want;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${ok ? '' : `expected ${want}, got ${got}`}`
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
