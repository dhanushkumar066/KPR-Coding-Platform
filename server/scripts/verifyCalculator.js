/**
 * The on-screen calculator's arithmetic.
 *
 * A calculator that quietly computes the wrong answer during an exam is worse
 * than no calculator: the student trusts it, writes the number down, and has no
 * reason to check. So the engine is tested directly rather than by clicking
 * buttons and eyeballing the result.
 *
 * Two things get particular attention. Degrees, because GATE questions are
 * posed in degrees and a calculator silently working in radians would give
 * plausible-looking wrong answers all paper. And the error cases — a square
 * root of a negative, a log of zero — because returning NaN and rendering it as
 * a number is exactly how a wrong answer gets written down.
 *
 * Run: npm run verify:calculator
 */
import {
  initialState,
  digit,
  dot,
  backspace,
  clearAll,
  clearEntry,
  operator,
  equals,
  unary,
  negate,
  constant,
  setAngle,
  memory,
  formatDisplay,
  keyToAction,
} from '../../client/src/lib/calculator.js';

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = String(got) === String(want);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}\n         got  ${got}\n         want ${want}`);
  }
}

/** Types a sequence of key presses and returns what the display shows. */
function run(keys, start = initialState()) {
  let s = start;
  for (const k of keys) {
    if (typeof k === 'string' && /^[0-9]$/.test(k)) s = digit(s, k);
    else if (k === '.') s = dot(s);
    else if (['+', '-', '*', '/', '^'].includes(k)) s = operator(s, k);
    else if (k === '=') s = equals(s);
    else if (k === 'C') s = clearAll(s);
    else if (k === 'CE') s = clearEntry(s);
    else if (k === 'back') s = backspace(s);
    else if (k === '+/-') s = negate(s);
    else if (k === 'pi' || k === 'e') s = constant(s, k);
    else if (k.startsWith('mem:')) s = memory(s, k.slice(4));
    else if (k.startsWith('deg') || k.startsWith('rad')) s = setAngle(s, k);
    else s = unary(s, k);
  }
  return s;
}
const shows = (keys, start) => run(keys, start).display;

console.log('\nEntry');
check('digits accumulate', shows(['1', '2', '3']), '123');
check('leading zero is replaced', shows(['0', '5']), '5');
check('one decimal point only', shows(['1', '.', '2', '.', '3']), '1.23');
check('a bare point starts 0.', shows(['.', '5']), '0.5');
check('backspace removes a digit', shows(['1', '2', '3', 'back']), '12');
check('backspace to empty shows 0', shows(['7', 'back']), '0');
check('sign flip', shows(['5', '+/-']), '-5');
check('sign flips back', shows(['5', '+/-', '+/-']), '5');

console.log('\nArithmetic');
check('2 + 3 =', shows(['2', '+', '3', '=']), '5');
check('10 - 4 =', shows(['1', '0', '-', '4', '=']), '6');
check('6 x 7 =', shows(['6', '*', '7', '=']), '42');
check('9 / 4 =', shows(['9', '/', '4', '=']), '2.25');
check('2 ^ 10 =', shows(['2', '^', '1', '0', '=']), '1024');
check(
  'immediate execution: 2 + 3 x 4 = 20, not 14',
  shows(['2', '+', '3', '*', '4', '=']),
  '20'
);
check('chaining shows the running total', shows(['2', '+', '3', '+']), '5');
check('= with nothing pending leaves the number', shows(['7', '=']), '7');
check('a second operator replaces the first', shows(['8', '+', '-', '3', '=']), '5');

console.log('\nThe floating-point artefact stays hidden');
check('0.1 + 0.2 shows 0.3', shows(['0', '.', '1', '+', '0', '.', '2', '=']), '0.3');
check('and not 0.30000000000000004', shows(['0', '.', '1', '+', '0', '.', '2', '=']) === '0.30000000000000004', false);
check('1 / 3', shows(['1', '/', '3', '=']), '0.333333333333');

console.log('\nDegrees — GATE poses its questions in them');
check('sin 30 = 0.5', shows(['3', '0', 'sin']), '0.5');
check('cos 60 = 0.5', shows(['6', '0', 'cos']), '0.5');
check('tan 45 = 1', shows(['4', '5', 'tan']), '1');
check('sin 90 = 1', shows(['9', '0', 'sin']), '1');
check(
  'radians when asked: sin(pi/2) = 1',
  shows(['pi', '/', '2', '=', 'sin'], setAngle(initialState(), 'rad')),
  '1'
);
check('asin 0.5 = 30 degrees', shows(['0', '.', '5', 'asin']), '30');

console.log('\nScientific functions');
check('sqrt 144', shows(['1', '4', '4', 'sqrt']), '12');
check('7 squared', shows(['7', 'sqr']), '49');
check('3 cubed', shows(['3', 'cube']), '27');
check('log 1000', shows(['1', '0', '0', '0', 'log']), '3');
check('ln e = 1', shows(['e', 'ln']), '1');
check('1/4', shows(['4', 'inv']), '0.25');
check('10^3', shows(['3', 'pow10']), '1000');
check('5!', shows(['5', 'fact']), '120');
check('0! = 1', shows(['0', 'fact']), '1');
check('pi', shows(['pi']), '3.14159265359');

console.log('\nErrors are refused, never rendered as a number');
check('divide by zero', shows(['5', '/', '0', '=']), 'Error');
check('sqrt of a negative', shows(['9', '+/-', 'sqrt']), 'Error');
check('log of zero', shows(['0', 'log']), 'Error');
check('ln of a negative', shows(['5', '+/-', 'ln']), 'Error');
check('1/0', shows(['0', 'inv']), 'Error');
check('arcsine outside its range', shows(['2', 'asin']), 'Error');
check('factorial of a fraction', shows(['2', '.', '5', 'fact']), 'Error');
check('factorial of a negative', shows(['3', '+/-', 'fact']), 'Error');
check(
  'an error carries a plain-English reason',
  run(['9', '+/-', 'sqrt']).error,
  'Square root of a negative number'
);
check('C recovers from an error', shows(['5', '/', '0', '=', 'C']), '0');
check('and lets work continue', shows(['5', '/', '0', '=', 'C', '2', '+', '2', '=']), '4');

console.log('\nMemory');
check('store and recall', shows(['4', '2', 'mem:MS', 'C', 'mem:MR']), '42');
check('add to memory', shows(['1', '0', 'mem:MS', '5', 'mem:M+', 'C', 'mem:MR']), '15');
check('subtract from memory', shows(['1', '0', 'mem:MS', '4', 'mem:M-', 'C', 'mem:MR']), '6');
check('clear memory', shows(['9', 'mem:MS', 'mem:MC', 'C', 'mem:MR']), '0');
check('memory survives C', run(['7', 'mem:MS', 'C']).memory, 7);

console.log('\nClear behaves as a calculator should');
check('CE clears the entry, keeping the pending sum', shows(['8', '+', '5', 'CE', '2', '=']), '10');
check('C clears everything', shows(['8', '+', '5', 'C', '2', '=']), '2');

console.log('\nDisplay formatting');
check('a whole number has no decimal point', formatDisplay(5), '5');
check('very large uses an exponent', formatDisplay(1.5e20), '1.500000e+20');
check('very small uses an exponent', formatDisplay(1.5e-20), '1.500000e-20');
check('infinity is an error, not a number', formatDisplay(Infinity), 'Error');
check('NaN is an error, not a number', formatDisplay(NaN), 'Error');
check('negative zero shows as 0', formatDisplay(-0), '0');

console.log('\nKeyboard');
check('a digit key', keyToAction('7')?.value, '7');
check('Enter evaluates', keyToAction('Enter')?.type, 'equals');
check('x is multiply', keyToAction('x')?.value, '*');
check('Escape clears', keyToAction('Escape')?.type, 'clear');
check('an unmapped key does nothing', keyToAction('q'), null);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
