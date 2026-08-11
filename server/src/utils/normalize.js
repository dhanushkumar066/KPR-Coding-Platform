/**
 * Canonical form used for every output comparison.
 *
 * Students lose marks for wrong answers, never for a trailing newline or a
 * stray space at the end of a line — so line endings are unified, trailing
 * horizontal whitespace is stripped per line, and trailing blank lines are
 * removed. Interior whitespace is left alone because it is often significant.
 */
export function normalizeOutput(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

/**
 * How an answer is compared.
 *
 * The defaults are exact text, which is right for most questions. The options
 * exist for the two families where exact text marks a correct student wrong:
 *
 * - `ignoreOrder` — the answer is a set, not a sequence. LeetCode's "3Sum",
 *   "Group Anagrams" and "Subsets" accept the right elements in any order.
 * - `ignoreInnerOrder` — the same, one level down. "3Sum" also accepts
 *   `[-1,0,1]` written as `[0,-1,1]`; "Permutations" does not, so the two are
 *   separate switches.
 * - `tolerance` — numbers need only be close. Floating-point answers cannot be
 *   compared as text because the languages format them differently.
 */
export const DEFAULT_COMPARE = { ignoreOrder: false, ignoreInnerOrder: false, tolerance: 0 };

const isExactTextCompare = (o) => !o.ignoreOrder && !o.ignoreInnerOrder && !o.tolerance;

function tryParseJson(text) {
  if (!text) return { ok: false };
  const first = text[0];
  // Only structured answers are worth parsing; a bare word would parse as
  // invalid JSON anyway, and a bare number gains nothing from this path.
  if (first !== '[' && first !== '{') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** Deterministic ordering key, so sorting both sides makes them comparable. */
const sortKey = (value) => JSON.stringify(value) ?? 'null';
const byCanonical = (a, b) => {
  const x = sortKey(a);
  const y = sortKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

function numbersMatch(a, b, tolerance) {
  if (Object.is(a, b)) return true;
  if (!tolerance) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  // Relative for large magnitudes, absolute near zero — the usual convention,
  // and what keeps 1e9 from needing nine significant digits of luck.
  return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Rewrites an answer into a canonical shape, innermost first.
 *
 * The order matters: an outer array can only be sorted meaningfully once its
 * elements are themselves canonical. Sorting `[[0,-1,1],[2,-1,-1]]` from the
 * outside pairs it against the wrong triplets; sorting each triplet first turns
 * both sides into the same thing.
 *
 * The sort is lexicographic on the JSON text rather than semantic. That is
 * fine — it only has to be *the same* ordering on both sides.
 */
function canonicalize(value, options, depth = 0) {
  if (!Array.isArray(value)) return value;
  const items = value.map((v) => canonicalize(v, options, depth + 1));
  const unordered = depth === 0 ? options.ignoreOrder : options.ignoreInnerOrder;
  return unordered ? items.sort(byCanonical) : items;
}

/** Compares two already-canonical answers positionally. */
function structuralMatch(a, b, options) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((x, i) => structuralMatch(x, b[i], options));
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return numbersMatch(a, b, options.tolerance);
  }
  return a === b;
}

/** Falls back to whole lines when the answer is not JSON — stdin-mode questions. */
function linesMatch(actual, expected, options) {
  const split = (s) => s.split('\n');
  let a = split(actual);
  let b = split(expected);
  if (a.length !== b.length) return false;

  if (options.ignoreOrder) {
    a = [...a].sort();
    b = [...b].sort();
  }

  if (!options.tolerance) return a.every((line, i) => line === b[i]);

  return a.every((line, i) => {
    if (line === b[i]) return true;
    const x = Number(line);
    const y = Number(b[i]);
    return Number.isFinite(x) && Number.isFinite(y) && numbersMatch(x, y, options.tolerance);
  });
}

export function outputsMatch(actual, expected, compare) {
  const options = { ...DEFAULT_COMPARE, ...(compare || {}) };
  const a = normalizeOutput(actual);
  const b = normalizeOutput(expected);

  // The overwhelmingly common case, and the cheapest. Also means a question
  // that needs no leniency behaves exactly as it always has.
  if (a === b) return true;
  if (isExactTextCompare(options)) return false;

  const parsedA = tryParseJson(a);
  const parsedB = tryParseJson(b);
  if (parsedA.ok && parsedB.ok) {
    return structuralMatch(
      canonicalize(parsedA.value, options),
      canonicalize(parsedB.value, options),
      options
    );
  }

  return linesMatch(a, b, options);
}

/** Keeps a stored blob from growing unbounded when a program spams output. */
export function truncate(value, max = 4000) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}\n… (truncated, ${s.length} chars total)` : s;
}
