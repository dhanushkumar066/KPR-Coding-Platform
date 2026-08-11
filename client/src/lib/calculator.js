/**
 * The engine behind the on-screen scientific calculator.
 *
 * Kept pure and separate from the component so it can be tested directly —
 * `npm run verify:calculator`. A calculator that quietly computes the wrong
 * answer during an exam is worse than no calculator at all: the student trusts
 * it, writes the number down, and has no reason to check.
 *
 * Immediate-execution semantics, like every hand-held scientific calculator and
 * like GATE's own: pressing an operator applies whatever is pending rather than
 * building an expression tree. `2 + 3 × 4` gives 20, not 14 — which is what
 * candidates who have used one expect, and being surprising here would cost
 * marks.
 */

/** Digits kept internally. The display rounds; the arithmetic does not. */
const PRECISION = 12;

export const initialState = () => ({
  /** What the screen shows, always a string so "2." and "2.0" survive typing. */
  display: '0',
  /** The left-hand side of a pending operation. */
  accumulator: null,
  /** The operator waiting for its right-hand side. */
  pendingOp: null,
  /** True while the next digit should replace the display rather than append. */
  replace: true,
  memory: 0,
  angle: 'deg',
  error: null,
  /** The last thing computed, shown small above the display. */
  history: '',
});

const num = (s) => Number(s);

/**
 * Formats a result for a display of finite width.
 *
 * 0.1 + 0.2 is 0.30000000000000004 in binary floating point. Showing that to a
 * student in an exam invites them to write it down, or to distrust a calculator
 * that is in fact correct. Rounding to 12 significant digits hides the artefact
 * without hiding any precision they could legitimately use.
 */
export function formatDisplay(value) {
  if (!Number.isFinite(value)) return 'Error';
  if (value === 0) return '0';

  const abs = Math.abs(value);
  // Beyond this a fixed-point rendering is unreadable; fall back to exponent.
  if (abs >= 1e12 || abs < 1e-11) {
    return value.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
  }
  const rounded = Number(value.toPrecision(PRECISION));
  return String(rounded);
}

function fail(state, message) {
  return { ...state, display: 'Error', error: message, replace: true, pendingOp: null, accumulator: null };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function digit(state, d) {
  if (state.error) return state;
  const cur = state.replace ? '' : state.display === '0' ? '' : state.display;
  // A display that grows without bound would overflow its box mid-exam.
  if (cur.replace(/[-.]/g, '').length >= 15) return state;
  return { ...state, display: `${cur}${d}`, replace: false };
}

export function dot(state) {
  if (state.error) return state;
  if (state.replace) return { ...state, display: '0.', replace: false };
  if (state.display.includes('.')) return state;
  return { ...state, display: `${state.display}.` };
}

export function backspace(state) {
  if (state.error) return initialState();
  if (state.replace) return state;
  const next = state.display.slice(0, -1);
  return { ...state, display: next === '' || next === '-' ? '0' : next, replace: next === '' };
}

/** C — everything. */
export function clearAll(state) {
  return { ...initialState(), memory: state.memory, angle: state.angle };
}

/** CE — just what is being typed, leaving a pending operation intact. */
export function clearEntry(state) {
  if (state.error) return clearAll(state);
  return { ...state, display: '0', replace: true };
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

function apply(op, a, b) {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? NaN : a / b;
    case '^':
      return a ** b;
    default:
      return b;
  }
}

const OP_LABEL = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^' };

export function operator(state, op) {
  if (state.error) return state;
  const value = num(state.display);

  // Two operators in a row replaces the pending one rather than computing with
  // a value the student never entered.
  if (state.pendingOp && state.replace) {
    return { ...state, pendingOp: op, history: `${formatDisplay(state.accumulator)} ${OP_LABEL[op]}` };
  }

  const acc = state.pendingOp !== null ? apply(state.pendingOp, state.accumulator, value) : value;
  if (!Number.isFinite(acc)) return fail(state, 'Cannot divide by zero');

  return {
    ...state,
    accumulator: acc,
    pendingOp: op,
    display: formatDisplay(acc),
    replace: true,
    history: `${formatDisplay(acc)} ${OP_LABEL[op]}`,
  };
}

export function equals(state) {
  if (state.error) return state;
  if (state.pendingOp === null) return { ...state, replace: true };

  const value = num(state.display);
  const result = apply(state.pendingOp, state.accumulator, value);
  if (!Number.isFinite(result)) return fail(state, 'Cannot divide by zero');

  return {
    ...state,
    display: formatDisplay(result),
    history: `${formatDisplay(state.accumulator)} ${OP_LABEL[state.pendingOp]} ${formatDisplay(value)} =`,
    accumulator: null,
    pendingOp: null,
    replace: true,
  };
}

// ---------------------------------------------------------------------------
// Scientific functions — applied immediately to what is on the display
// ---------------------------------------------------------------------------

const toRad = (state, x) => (state.angle === 'deg' ? (x * Math.PI) / 180 : x);
const fromRad = (state, x) => (state.angle === 'deg' ? (x * 180) / Math.PI : x);

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) return NaN;
  // 171! overflows a double; stopping here is honest about the limit rather
  // than returning Infinity and calling it an answer.
  if (n > 170) return Infinity;
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
}

const UNARY = {
  sin: (s, x) => Math.sin(toRad(s, x)),
  cos: (s, x) => Math.cos(toRad(s, x)),
  tan: (s, x) => Math.tan(toRad(s, x)),
  asin: (s, x) => (x < -1 || x > 1 ? NaN : fromRad(s, Math.asin(x))),
  acos: (s, x) => (x < -1 || x > 1 ? NaN : fromRad(s, Math.acos(x))),
  atan: (s, x) => fromRad(s, Math.atan(x)),
  log: (s, x) => (x <= 0 ? NaN : Math.log10(x)),
  ln: (s, x) => (x <= 0 ? NaN : Math.log(x)),
  sqrt: (s, x) => (x < 0 ? NaN : Math.sqrt(x)),
  sqr: (s, x) => x * x,
  cube: (s, x) => x ** 3,
  inv: (s, x) => (x === 0 ? NaN : 1 / x),
  exp: (s, x) => Math.exp(x),
  pow10: (s, x) => 10 ** x,
  fact: (s, x) => factorial(x),
  abs: (s, x) => Math.abs(x),
};

const UNARY_ERROR = {
  asin: 'Outside the range of arcsine (−1 to 1)',
  acos: 'Outside the range of arccosine (−1 to 1)',
  log: 'Logarithm needs a positive number',
  ln: 'Logarithm needs a positive number',
  sqrt: 'Square root of a negative number',
  inv: 'Cannot divide by zero',
  fact: 'Factorial needs a whole number, zero or more',
};

export function unary(state, name) {
  if (state.error) return state;
  const fn = UNARY[name];
  if (!fn) return state;

  const x = num(state.display);
  const result = fn(state, x);
  if (!Number.isFinite(result)) return fail(state, UNARY_ERROR[name] || 'Not a number');

  return {
    ...state,
    display: formatDisplay(result),
    history: `${name}(${formatDisplay(x)})`,
    replace: true,
  };
}

/** Sign flip is not an operation — it edits the number being typed. */
export function negate(state) {
  if (state.error) return state;
  if (state.display === '0') return state;
  const next = state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`;
  return { ...state, display: next };
}

export function constant(state, name) {
  if (state.error) return state;
  const value = name === 'pi' ? Math.PI : Math.E;
  return { ...state, display: formatDisplay(value), replace: true };
}

export function setAngle(state, angle) {
  return { ...state, angle };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function memory(state, action) {
  if (state.error && action !== 'MC') return state;
  const x = num(state.display);
  switch (action) {
    case 'MS':
      return { ...state, memory: x, replace: true };
    case 'MR':
      return { ...state, display: formatDisplay(state.memory), replace: true };
    case 'M+':
      return { ...state, memory: state.memory + x, replace: true };
    case 'M-':
      return { ...state, memory: state.memory - x, replace: true };
    case 'MC':
      return { ...state, memory: 0 };
    default:
      return state;
  }
}

/** Maps a keyboard key to an action, so the number pad works. */
export function keyToAction(key) {
  if (/^[0-9]$/.test(key)) return { type: 'digit', value: key };
  if (key === '.') return { type: 'dot' };
  if (key === '+' || key === '-') return { type: 'operator', value: key };
  if (key === '*' || key === 'x') return { type: 'operator', value: '*' };
  if (key === '/') return { type: 'operator', value: '/' };
  if (key === '^') return { type: 'operator', value: '^' };
  if (key === 'Enter' || key === '=') return { type: 'equals' };
  if (key === 'Backspace') return { type: 'backspace' };
  if (key === 'Escape' || key === 'Delete') return { type: 'clear' };
  return null;
}
