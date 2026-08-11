/**
 * Accepts test-case input written the way LeetCode displays it.
 *
 * A teacher setting a question copies the shape they have seen on the site:
 *
 *   nums = [2,7,11,15], target = 9
 *   a = 10
 *   b = 20
 *
 * That is LeetCode's *display* format. Its internal data is just the values,
 * one per argument, and so is ours — the generated harness reads one JSON value
 * per line. Demanding the internal form and rejecting the familiar one taught
 * teachers nothing except that the tool was fussy.
 *
 * So both are accepted and stored canonically. The labelled form is what gets
 * shown back to students, so the question still reads like LeetCode.
 */

/**
 * Splits on newlines and on commas that are not inside brackets or quotes.
 *
 * The bracket depth is what makes `nums = [2,7,11,15], target = 9` split into
 * two segments rather than five.
 */
function splitSegments(text) {
  const out = [];
  let depth = 0;
  let inString = false;
  let cur = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      cur += ch;
      if (ch === '\\') {
        // Keep the escaped character with its backslash.
        cur += text[i + 1] ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;

    if (depth === 0 && (ch === '\n' || ch === ',')) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);

  return out.map((s) => s.trim()).filter(Boolean);
}

const IDENT = /^[A-Za-z_]\w*$/;

/**
 * Rewrites one case's input into the canonical one-value-per-line form.
 *
 * @param {object} spec the question's functionSpec
 * @param {string} raw whatever the teacher typed
 * @returns {{ok: true, input: string, relabelled: boolean} | {ok: false, error: string}}
 */
export function normaliseCaseInput(spec, raw) {
  const text = String(raw ?? '').replace(/\n+$/, '');
  if (!text.trim()) return { ok: true, input: text, relabelled: false };

  const params = spec?.params || [];
  if (!params.length) return { ok: true, input: text, relabelled: false };

  const names = params.map((p) => p.name);
  const segments = splitSegments(text);

  // A segment counts as labelled only when the name before `=` is one this
  // question actually declares — otherwise `s = "x=y"` would be misread.
  const labelled = new Map();
  let labelledCount = 0;

  for (const segment of segments) {
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const name = segment.slice(0, eq).trim();
    if (!IDENT.test(name) || !names.includes(name)) continue;
    labelledCount += 1;
    if (!labelled.has(name)) labelled.set(name, segment.slice(eq + 1).trim());
  }

  // Nothing labelled: already the raw form, leave it exactly as written.
  if (labelledCount === 0) return { ok: true, input: text, relabelled: false };

  const missing = names.filter((n) => !labelled.has(n));
  if (missing.length) {
    return {
      ok: false,
      error: `this case labels ${[...labelled.keys()].map((n) => `"${n}"`).join(', ')} but not ${missing
        .map((n) => `"${n}"`)
        .join(', ')}. Either label every argument — ${names
        .map((n) => `${n} = …`)
        .join(', ')} — or label none of them and give one value per line.`,
    };
  }

  // Reordered into the signature's order, so `target = 9, nums = [...]` works
  // as well as the other way round.
  return {
    ok: true,
    input: names.map((n) => labelled.get(n)).join('\n'),
    relabelled: true,
  };
}

/**
 * The labelled form, for showing a case back to a student.
 *
 * This is what makes a question read like the ones they have practised on:
 * `nums = [2,7,11,15], target = 9` rather than two bare lines.
 */
export function labelCaseInput(spec, canonical) {
  const params = spec?.params || [];
  const lines = String(canonical ?? '')
    .replace(/\n+$/, '')
    .split('\n');

  if (!params.length || lines.length !== params.length) return null;

  return params.map((p, i) => `${p.name} = ${lines[i].trim()}`).join(', ');
}
