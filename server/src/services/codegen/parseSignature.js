/**
 * Turns a signature a teacher already has into a function spec.
 *
 * Nobody should have to assemble a signature from dropdowns. A teacher setting
 * "Two Sum" almost always has the shape in front of them already — from a
 * textbook, from LeetCode, from last year's paper — so the fastest correct path
 * is to let them paste it and read it back.
 *
 * All five languages are accepted, in the forms they are actually written:
 *
 *   def twoSum(self, nums: List[int], target: int) -> List[int]:
 *   public int[] twoSum(int[] nums, int target)
 *   vector<int> twoSum(vector<int>& nums, int target)
 *   int* twoSum(int* nums, int numsSize, int target, int* returnSize)
 *   var twoSum = function(nums, target)
 *
 * Parsing is deliberately deterministic — no language model. A signature that
 * cannot be read is reported as such so the teacher can fix it, rather than
 * being guessed at and silently producing the wrong stub.
 */
import { FUNCTION_TYPES, RETURN_TYPES } from './types.js';

/**
 * One spelling per row, mapped to our vocabulary. Checked longest-first so
 * `long long` wins over `long` and `vector<vector<int>>` over `vector<int>`.
 */
const TYPE_ALIASES = [
  // Node types.
  ['optional[listnode]', 'list'],
  ['optional[treenode]', 'tree'],
  ['listnode*', 'list'],
  ['treenode*', 'tree'],
  ['listnode', 'list'],
  ['treenode', 'tree'],
  ['struct listnode*', 'list'],
  ['struct treenode*', 'tree'],

  // 2-D.
  ['list[list[int]]', 'int[][]'],
  ['list[list[str]]', 'string[][]'],
  ['list[list[float]]', 'double[][]'],
  ['list[list[bool]]', 'boolean[][]'],
  ['vector<vector<int>>', 'int[][]'],
  ['vector<vector<long long>>', 'long[][]'],
  ['vector<vector<double>>', 'double[][]'],
  ['vector<vector<bool>>', 'boolean[][]'],
  ['vector<vector<char>>', 'char[][]'],
  ['vector<vector<string>>', 'string[][]'],
  ['int[][]', 'int[][]'],
  ['long[][]', 'long[][]'],
  ['double[][]', 'double[][]'],
  ['boolean[][]', 'boolean[][]'],
  ['char[][]', 'char[][]'],
  ['string[][]', 'string[][]'],
  ['int**', 'int[][]'],
  ['char***', 'string[][]'],

  // 1-D.
  ['list[int]', 'int[]'],
  ['list[str]', 'string[]'],
  ['list[float]', 'double[]'],
  ['list[bool]', 'boolean[]'],
  ['vector<int>', 'int[]'],
  ['vector<long long>', 'long[]'],
  ['vector<double>', 'double[]'],
  ['vector<bool>', 'boolean[]'],
  ['vector<char>', 'char[]'],
  ['vector<string>', 'string[]'],
  ['int[]', 'int[]'],
  ['long[]', 'long[]'],
  ['double[]', 'double[]'],
  ['boolean[]', 'boolean[]'],
  ['char[]', 'char[]'],
  ['string[]', 'string[]'],
  ['integer[]', 'int[]'],
  ['int*', 'int[]'],
  ['char**', 'string[]'],

  // Scalars.
  ['long long', 'long'],
  ['integer', 'int'],
  ['int', 'int'],
  ['long', 'long'],
  ['double', 'double'],
  ['float', 'double'],
  ['boolean', 'boolean'],
  ['bool', 'boolean'],
  ['char*', 'string'],
  ['char', 'char'],
  ['string', 'string'],
  ['str', 'string'],
  ['void', 'void'],
  ['none', 'void'],
];

/** Strips reference/const noise so `const vector<int>&` reads as `vector<int>`. */
function tidyType(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/\bconst\b/g, '')
    .replace(/&/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*<\s*/g, '<')
    .replace(/\s*>\s*/g, '>')
    .replace(/>\s*>/g, '>>')
    .replace(/\s*\[\s*\]/g, '[]')
    .replace(/\s*\*/g, '*')
    .trim();
}

function mapType(raw) {
  const t = tidyType(raw);
  if (!t) return null;
  for (const [alias, mapped] of TYPE_ALIASES) {
    if (t === alias) return mapped;
  }
  return null;
}

/** Splits a parameter list on commas that are not inside <> or []. */
function splitParams(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '<' || ch === '[') depth += 1;
    if (ch === '>' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * C carries array lengths as extra parameters (`int* nums, int numsSize`) and
 * returns them through out-params. Those are an artefact of the language, not
 * part of the question, so they are dropped rather than surfaced to the teacher.
 */
function isCCompanion(name, params, index) {
  const lower = name.toLowerCase();
  if (lower === 'returnsize' || lower === 'returncolumnsizes') return true;

  // Match against the array the companion belongs to, not merely the parameter
  // before it: a 2-D array produces `matrix, matrixSize, matrixColSize`, so by
  // the time we reach `matrixColSize` the previous parameter is another
  // companion rather than `matrix`.
  const earlier = params.slice(0, index).map((p) => p.name.toLowerCase());
  for (const suffix of ['colsize', 'columnsizes', 'size']) {
    if (lower.endsWith(suffix)) {
      const base = lower.slice(0, -suffix.length);
      if (base && earlier.includes(base)) return true;
    }
  }
  return false;
}

/** Python's implicit receiver is not a parameter of the problem. */
const isSelf = (name) => name === 'self' || name === 'cls';

function parsePython(src) {
  const m = src.match(/def\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*(?:->\s*([^:]+))?\s*:?\s*$/);
  if (!m) return null;

  const [, name, paramText, returnText] = m;
  const params = [];

  for (const piece of splitParams(paramText)) {
    // `nums: List[int]` or `nums: List[int] = None` or bare `nums`.
    const [lhs] = piece.split('=');
    const [rawName, rawType] = lhs.split(':').map((s) => s?.trim());
    if (!rawName || isSelf(rawName)) continue;
    params.push({ name: rawName, type: rawType ? mapType(rawType) : null });
  }

  return { name, params, returnType: returnText ? mapType(returnText) : null };
}

/** Java, C++ and C all read as `<return> <name>(<params>)`. */
function parseCLike(src) {
  const m = src.match(
    /(?:public\s+|private\s+|protected\s+|static\s+|virtual\s+|inline\s+)*([A-Za-z_][\w:<>,\s*&\[\]]*?)\s+\*?\s*([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*(?:const)?\s*[;{]?\s*$/
  );
  if (!m) return null;

  const [, rawReturn, name, paramText] = m;

  const raw = [];
  for (const piece of splitParams(paramText)) {
    if (piece === 'void') continue;
    // The name is the *last* identifier; everything before it is the type,
    // pointer stars and all. The greedy prefix is what makes `int** matrix`
    // yield `int**` rather than stopping at the first star.
    const pm = piece.match(/^([\s\S]*[\s*])\s*([A-Za-z_]\w*)\s*((?:\[\s*\])*)$/);
    if (!pm) return null;
    const [, prefix, pName, trailingBrackets] = pm;
    // `int nums[]` puts the brackets after the name instead of the type.
    const rawType = prefix + (trailingBrackets || '');
    raw.push({ name: pName, type: rawType });
  }

  const params = raw
    .filter((p, i) => !isCCompanion(p.name, raw, i))
    .map((p) => ({ name: p.name, type: mapType(p.type) }));

  return { name, params, returnType: mapType(rawReturn) };
}

function parseJs(src) {
  const m =
    src.match(/(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*function\s*\(([\s\S]*?)\)/) ||
    src.match(/function\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)/);
  if (!m) return null;

  const [, name, paramText] = m;
  return {
    name,
    // JavaScript carries no types, so they stay unknown and the caller either
    // infers them from the test cases or asks.
    params: splitParams(paramText).map((p) => ({ name: p.split('=')[0].trim(), type: null })),
    returnType: null,
  };
}

/**
 * @param {string} source a signature in any supported language
 * @returns {{ok: boolean, spec?: object, unknown?: string[], error?: string}}
 *   `unknown` names the parameters whose type could not be read, so the UI can
 *   highlight exactly those rather than rejecting the whole paste.
 */
export function parseSignature(source) {
  const src = String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '')
    .trim();

  if (!src) return { ok: false, error: 'Paste a function signature first' };

  const parsed = /\bdef\s/.test(src)
    ? parsePython(src)
    : /\bfunction\b/.test(src)
      ? parseJs(src)
      : parseCLike(src);

  if (!parsed) {
    return {
      ok: false,
      error:
        'Could not read that as a function signature. Paste one line, e.g. int[] twoSum(int[] nums, int target)',
    };
  }
  if (!IDENT.test(parsed.name)) {
    return { ok: false, error: `"${parsed.name}" is not a usable function name` };
  }
  if (!parsed.params.length) {
    return { ok: false, error: 'That signature has no parameters — a question needs at least one' };
  }

  const badName = parsed.params.find((p) => !IDENT.test(p.name || ''));
  if (badName) {
    return { ok: false, error: `Could not read a parameter name in that signature` };
  }

  const unknown = parsed.params.filter((p) => !p.type).map((p) => p.name);
  const returnType = parsed.returnType && RETURN_TYPES.includes(parsed.returnType)
    ? parsed.returnType
    : null;

  const params = parsed.params.map((p) => ({
    name: p.name,
    type: FUNCTION_TYPES.includes(p.type) ? p.type : 'int',
    harnessOnly: false,
    of: '',
  }));

  /*
   * A void signature has to nominate the parameter holding the answer, and a
   * pasted line cannot say which. When there is exactly one candidate — as in
   * `void solveSudoku(char[][] board)` or `void moveZeroes(int[] nums)` — there
   * is nothing to choose between, so choosing is not a guess. With more than
   * one it stays blank and the teacher picks.
   */
  let outputParam = '';
  if (returnType === 'void') {
    const candidates = params.filter((p) => p.type !== 'node');
    if (candidates.length === 1) outputParam = candidates[0].name;
  }

  return {
    ok: true,
    unknown,
    returnTypeKnown: Boolean(returnType),
    spec: {
      name: parsed.name,
      returnType: returnType || 'int',
      outputParam,
      params,
    },
  };
}

/**
 * Reads a type out of one JSON value from a test case.
 *
 * Used to fill in the types a signature could not supply — JavaScript carries
 * none at all, and a teacher may paste an untyped line. Inference is only ever
 * a suggestion: the teacher sees the result in the builder and can correct it.
 */
export function inferType(jsonText) {
  let value;
  try {
    value = JSON.parse(String(jsonText).trim());
  } catch {
    return null;
  }
  return typeOfValue(value);
}

function typeOfValue(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return 'double';
    // Beyond 32 bits an int would overflow in Java and C.
    return Math.abs(value) > 2147483647 ? 'long' : 'int';
  }
  if (typeof value === 'string') return 'string';

  if (Array.isArray(value)) {
    if (!value.length) return 'int[]'; // nothing to go on; the commonest case
    const inner = value.map(typeOfValue).filter(Boolean);
    if (!inner.length) return 'int[]';
    // A mixed array is not expressible, so fall back to the widest member.
    const first = inner[0];
    const same = inner.every((t) => t === first);
    const base = same ? first : inner.includes('double') ? 'double' : 'string';
    return base.endsWith('[]') ? `${base.replace(/\[\]$/, '')}[][]`.replace('[][][]', '[][]') : `${base}[]`;
  }
  return null;
}

/**
 * Fills in whatever the signature could not say, using the first test case.
 *
 * @param {object} spec a spec from parseSignature
 * @param {string} inputText the case's input, one JSON value per line
 * @param {string} expectedText the case's expected output
 */
export function inferMissingTypes(spec, inputText, expectedText) {
  const lines = String(inputText || '')
    .replace(/\n+$/, '')
    .split('\n');

  const params = spec.params.map((p, i) => {
    const guess = lines[i] !== undefined ? inferType(lines[i]) : null;
    return guess ? { ...p, type: guess } : p;
  });

  const returned = expectedText ? inferType(expectedText) : null;

  return {
    ...spec,
    params,
    returnType: returned && RETURN_TYPES.includes(returned) ? returned : spec.returnType,
  };
}
