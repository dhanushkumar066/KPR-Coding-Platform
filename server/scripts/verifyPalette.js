/**
 * The GATE palette's two contracts:
 *
 *   1. Marking a question for review never touches the answer under it.
 *   2. The five palette states are derived from the draft consistently.
 *
 * Contract 1 is the one that would hurt: a regression there wipes a student's
 * answer mid-exam, silently, at the moment they were being careful.
 *
 * Run: npm run verify:palette
 */
import { buildDraftPatch, paletteStateOf } from '../src/services/draftPatch.js';

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

const at = new Date('2026-01-01T00:00:00Z');
const patch = (input) => buildDraftPatch(input, at);
/** Everything the patch would change, minus the timestamp. */
const touched = (input) => {
  const { updatedAt, ...rest } = patch(input);
  return Object.keys(rest).sort();
};

console.log('\nMarking never disturbs the answer');
check('mark only touches nothing else', touched({ markedForReview: true }), ['markedForReview']);
check('unmark only touches nothing else', touched({ markedForReview: false }), ['markedForReview']);
check('visited only touches nothing else', touched({ visited: true }), ['visited']);
check('mark + visited together', touched({ markedForReview: true, visited: true }), [
  'markedForReview',
  'visited',
]);
check(
  'a mark-only call carries no code key at all',
  Object.prototype.hasOwnProperty.call(patch({ markedForReview: true }), 'code'),
  false
);
check(
  'a mark-only call carries no selectedOptions key',
  Object.prototype.hasOwnProperty.call(patch({ markedForReview: true }), 'selectedOptions'),
  false
);
check(
  'a mark-only call carries no natAnswer key',
  Object.prototype.hasOwnProperty.call(patch({ markedForReview: true }), 'natAnswer'),
  false
);

console.log('\nAnswers still save, and still clear');
check('code saves with its language', touched({ code: 'x', language: 'python' }), [
  'code',
  'language',
]);
check('NAT saves', touched({ natAnswer: '1.6' }), ['natAnswer']);
check('MCQ saves', touched({ selectedOptions: ['a'] }), ['selectedOptions']);
check('clearing NAT is an answer', touched({ natAnswer: '' }), ['natAnswer']);
check('clearing MCQ is an answer', touched({ selectedOptions: [] }), ['selectedOptions']);
check('clear + mark in one call does both', touched({ selectedOptions: [], markedForReview: true }), [
  'markedForReview',
  'selectedOptions',
]);
check('NAT wins when both are somehow sent', touched({ natAnswer: '2', selectedOptions: ['a'] }), [
  'natAnswer',
]);

console.log('\nThe five states');
check('untouched', paletteStateOf({}), 'notVisited');
check('opened and left blank', paletteStateOf({ visited: true }), 'notAnswered');
check('code answered', paletteStateOf({ visited: true, code: 'x' }), 'answered');
check('NAT answered', paletteStateOf({ visited: true, natAnswer: '1.6' }), 'answered');
check('MCQ answered', paletteStateOf({ visited: true, selectedOptions: ['a'] }), 'answered');
check('marked and blank', paletteStateOf({ visited: true, markedForReview: true }), 'marked');
check(
  'answered and marked',
  paletteStateOf({ visited: true, code: 'x', markedForReview: true }),
  'answeredMarked'
);
check('empty MCQ array is not an answer', paletteStateOf({ visited: true, selectedOptions: [] }), 'notAnswered');
check('empty NAT string is not an answer', paletteStateOf({ visited: true, natAnswer: '' }), 'notAnswered');
check(
  'a marked question never reads as unvisited',
  paletteStateOf({ markedForReview: true }),
  'marked'
);
check(
  'NAT "0" is an answer, not an empty one',
  paletteStateOf({ visited: true, natAnswer: '0' }),
  'answered'
);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
