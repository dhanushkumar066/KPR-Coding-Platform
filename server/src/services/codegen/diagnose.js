/**
 * Plain-English explanations for the ways code can be the wrong *shape* for a
 * function or class question.
 *
 * In these modes the platform supplies the program around the answer: the
 * `main`, the input parsing, the printing. Someone who writes a whole program
 * anyway gets a compiler message about a duplicate class, which says nothing
 * about what they actually did wrong.
 *
 * This runs only when compilation has already failed, so a false positive costs
 * nothing but an extra sentence — the real compiler output is always shown too.
 */

/** The wrapper each language expects the answer to live in. */
const REQUIRED_SHAPE = {
  python: 'class Solution:',
  java: 'class Solution {',
  cpp: 'class Solution {',
};

function hasSolutionClass(code, languageKey) {
  if (languageKey === 'python') return /^\s*class\s+Solution\s*[:(]/m.test(code);
  if (languageKey === 'java' || languageKey === 'cpp') {
    return /\bclass\s+Solution\b/.test(code);
  }
  return true; // C and JavaScript have no wrapper class.
}

/**
 * @param {string} code the submitted code
 * @param {string} languageKey
 * @param {object} spec functionSpec or classSpec
 * @param {'function'|'class'} mode
 * @returns {string|null} a sentence to show above the compiler output
 */
export function diagnoseSolutionShape(code, languageKey, spec, mode = 'function') {
  const src = String(code || '');
  if (!src.trim()) return null;

  const entryPoint = mode === 'class' ? spec?.name : spec?.name;

  // ---- a second `main` ---------------------------------------------------
  if (languageKey === 'java' && /\bclass\s+Main\b/.test(src)) {
    return `Your code declares "class Main", but the platform already provides one — that is the "duplicate class: Main" below. Put your method inside "class Solution" instead, exactly as the starter code shows. You never write main() here.`;
  }
  if ((languageKey === 'cpp' || languageKey === 'c') && /\bint\s+main\s*\(/.test(src)) {
    return `Your code defines main(), but the platform already provides one and calls your function from it. Delete main() and leave just ${
      languageKey === 'c' ? `the ${entryPoint || 'required'} function` : `"class Solution"`
    }, exactly as the starter code shows.`;
  }
  if (languageKey === 'java' && /\bstatic\s+void\s+main\s*\(/.test(src)) {
    return `Your code defines main(). The platform supplies main() and calls your method from it — write only the method inside "class Solution".`;
  }

  // ---- the wrapper the harness calls into is missing ---------------------
  if (!hasSolutionClass(src, languageKey)) {
    return `The platform calls your answer through "${REQUIRED_SHAPE[languageKey]}", which this code does not define. Press "Reset to template" to get the right shape back, then fill in the body.`;
  }

  // ---- the named function itself is missing ------------------------------
  if (entryPoint) {
    const named = new RegExp(`\\b${entryPoint}\\b`).test(src);
    if (!named) {
      return `This question expects a function called "${entryPoint}", which does not appear in your code. The name has to match exactly — that is how the platform finds it.`;
    }
  }

  // ---- reading input in a mode where nothing is on stdin ------------------
  const readsInput =
    (languageKey === 'python' && /\b(input\s*\(|sys\.stdin)/.test(src)) ||
    (languageKey === 'java' && /\b(Scanner|BufferedReader)\b/.test(src)) ||
    (languageKey === 'cpp' && /\bcin\s*>>/.test(src)) ||
    (languageKey === 'c' && /\b(scanf|fgets|getchar)\s*\(/.test(src)) ||
    (languageKey === 'javascript' && /readFileSync|process\.stdin/.test(src));

  if (readsInput) {
    return `This code reads from standard input, but in this mode the arguments are handed to your function directly and there is nothing on stdin to read. Delete the reading code and use the parameters.`;
  }

  return null;
}
