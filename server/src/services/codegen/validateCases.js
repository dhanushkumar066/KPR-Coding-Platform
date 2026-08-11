/**
 * Structural checks on a question's test cases.
 *
 * In function and class mode the harness feeds each case straight into a
 * generated driver, so the shape of the data is not a matter of taste — it
 * either parses or the student gets a crash they cannot do anything about.
 *
 * This is the check that would have caught "a=2 b=4": a human description of
 * the input sitting where two JSON values belong. It runs no code and makes no
 * guesses, so it can be enforced the moment a teacher saves.
 */
import { callParams, isNodeRefType } from './types.js';

const stripTrailingBlanks = (text) => String(text ?? '').replace(/\n+$/, '');

/** JSON, but tolerating a bare `null` and rejecting empty text. */
function parses(line) {
  const t = String(line).trim();
  if (!t) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a line for this parameter should look like, for the error message.
 * Being concrete here is the difference between a teacher fixing it in ten
 * seconds and filing a bug.
 */
function exampleFor(type) {
  switch (type) {
    case 'int':
    case 'long':
      return '42';
    case 'double':
      return '2.5';
    case 'boolean':
      return 'true';
    case 'char':
      return '"x"';
    case 'string':
      return '"hello"';
    case 'int[]':
    case 'long[]':
      return '[1,2,3]';
    case 'double[]':
      return '[1.5,2.5]';
    case 'boolean[]':
      return '[true,false]';
    case 'char[]':
      return '["a","b"]';
    case 'string[]':
      return '["a","b"]';
    case 'int[][]':
      return '[[1,2],[3,4]]';
    case 'char[][]':
      return '[["5","3"],[".","7"]]';
    case 'string[][]':
      return '[["a"],["b"]]';
    case 'list':
      return '[1,2,3]';
    case 'tree':
      return '[3,9,20,null,null,15,7]';
    case 'node':
      return '5';
    default:
      return '42';
  }
}

/**
 * @returns {string[]} one message per problem; empty means the cases are usable.
 */
export function validateTestCases(question) {
  const { ioMode, testCases = [] } = question;
  if (ioMode !== 'function' && ioMode !== 'class') return [];

  const errors = [];
  const label = (i) => `Test case ${i + 1}`;

  testCases.forEach((testCase, i) => {
    const input = stripTrailingBlanks(testCase.input);
    // An empty case is caught elsewhere; here it would only produce noise.
    if (!input.trim()) return;

    const lines = input.split('\n');

    if (ioMode === 'class') {
      if (lines.length !== 2) {
        errors.push(
          `${label(i)}: a design problem needs exactly two lines — the operations, then their arguments. This has ${lines.length}.`
        );
        return;
      }
      lines.forEach((line, j) => {
        if (!parses(line)) {
          errors.push(
            `${label(i)}, line ${j + 1}: not valid JSON. ${
              j === 0 ? 'Expected something like ["LRUCache","put","get"]' : 'Expected something like [[2],[1,1],[1]]'
            }`
          );
        }
      });
      return;
    }

    // ---- function mode ----
    const params = question.functionSpec?.params || [];
    if (!params.length) return;

    if (lines.length !== params.length) {
      errors.push(
        `${label(i)}: this question takes ${params.length} argument${params.length === 1 ? '' : 's'} (${params
          .map((p) => p.name)
          .join(', ')}), so the input needs ${params.length} line${params.length === 1 ? '' : 's'} — one JSON value each. This has ${lines.length}.`
      );
      return;
    }

    lines.forEach((line, j) => {
      const param = params[j];
      if (parses(line)) return;
      errors.push(
        `${label(i)}, line ${j + 1}: "${line.trim().slice(0, 40)}" is not a value the judge can read. Line ${j + 1} is ${
          param.name
        }, so write just the value — e.g. ${exampleFor(
          isNodeRefType(param.type) ? 'node' : param.type
        )} — not a description of it.`
      );
    });

    // The expected output travels the same way: it is compared against the JSON
    // the student's function returns.
    const expected = stripTrailingBlanks(testCase.expectedOutput);
    if (expected.trim() && !parses(expected)) {
      errors.push(
        `${label(i)}: the expected output "${expected.trim().slice(0, 40)}" is not valid JSON. Write the value the function returns — e.g. ${exampleFor(
          question.functionSpec?.returnType
        )}.`
      );
    }
  });

  // Function mode with a signature the student never receives any argument for
  // is unusable regardless of the cases.
  if (ioMode === 'function' && question.functionSpec?.name && !callParams(question.functionSpec).length) {
    errors.push('Every parameter is marked harness-only, so the student receives nothing to work with.');
  }

  return errors;
}
