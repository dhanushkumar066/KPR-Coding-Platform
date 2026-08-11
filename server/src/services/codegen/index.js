import * as python from './python.js';
import * as javascript from './javascript.js';
import * as java from './java.js';
import * as cpp from './cpp.js';
import * as c from './c.js';
import {
  callParams,
  DEFAULT_TOLERANCE,
  FUNCTION_LANGUAGES,
  FUNCTION_TYPES,
  NODE_TYPES,
  PARAM_TYPES,
  RETURN_TYPES,
  isNodeRefType,
  isNodeType,
  needsTolerance,
  nodeTypesUsed,
  outputParamFor,
  sourceParamFor,
  validateClassSpec,
  validateFunctionSpec,
} from './types.js';
import { stdinStub } from './stdinStub.js';
import { validateTestCases } from './validateCases.js';
import { diagnoseSolutionShape } from './diagnose.js';

const GENERATORS = { python, javascript, java, cpp, c };

export {
  callParams,
  DEFAULT_TOLERANCE,
  diagnoseSolutionShape,
  FUNCTION_LANGUAGES,
  FUNCTION_TYPES,
  NODE_TYPES,
  PARAM_TYPES,
  RETURN_TYPES,
  isNodeRefType,
  isNodeType,
  needsTolerance,
  nodeTypesUsed,
  outputParamFor,
  sourceParamFor,
  stdinStub,
  validateClassSpec,
  validateFunctionSpec,
  validateTestCases,
};

export const supportsFunctionMode = (languageKey) => Boolean(GENERATORS[languageKey]);

/** The starter code a student sees for a function-signature question. */
export function buildStub(spec, languageKey) {
  const gen = GENERATORS[languageKey];
  if (!gen) return '';
  return gen.stub(spec);
}

/** The starter code a student sees for a class ("design") question. */
export function buildClassStub(spec, languageKey) {
  const gen = GENERATORS[languageKey];
  if (!gen) return '';
  return gen.classStub(spec);
}

/** Class stubs for every supported language, keyed by language. */
export function buildAllClassStubs(spec) {
  const out = {};
  for (const key of FUNCTION_LANGUAGES) out[key] = GENERATORS[key].classStub(spec);
  return out;
}

/**
 * Wraps a student's class in the harness that replays the operation list.
 *
 * The test case is two lines — the operations and their arguments — and the
 * output is one entry per operation, exactly as LeetCode presents it.
 */
export function buildClassProgram(spec, languageKey, studentCode) {
  const gen = GENERATORS[languageKey];
  if (!gen) {
    throw new Error(
      `${languageKey} cannot be used for class questions. Supported: ${FUNCTION_LANGUAGES.join(', ')}.`
    );
  }
  return gen.classProgram(spec, studentCode);
}

/** The class as a human-readable signature list, for teacher-facing UI. */
export function classLabel(spec, languageKey = 'java') {
  const gen = GENERATORS[languageKey] || GENERATORS.java;
  const ctor = `${spec.name}(${spec.constructorParams
    .map((p) => `${gen.typeName(p.type, spec, p)} ${p.name}`)
    .join(', ')})`;
  const methods = spec.methods.map(
    (m) =>
      `${gen.typeName(m.returnType, spec)} ${m.name}(${m.params
        .map((p) => `${gen.typeName(p.type, spec, p)} ${p.name}`)
        .join(', ')})`
  );
  return [ctor, ...methods].join('\n');
}

/** Stubs for every supported language, keyed by language. */
export function buildAllStubs(spec) {
  const out = {};
  for (const key of FUNCTION_LANGUAGES) out[key] = GENERATORS[key].stub(spec);
  return out;
}

/**
 * Wraps the student's solution in the hidden driver that reads the arguments
 * from stdin, calls their function, and prints the result in canonical JSON.
 *
 * This is what actually goes to Judge0 — the student never sees it, and it is
 * the only reason a LeetCode-shaped question can run on a stdin/stdout judge.
 */
export function buildProgram(spec, languageKey, studentCode) {
  const gen = GENERATORS[languageKey];
  if (!gen) {
    throw new Error(
      `${languageKey} cannot be used for function-signature questions. Supported: ${FUNCTION_LANGUAGES.join(', ')}.`
    );
  }
  return gen.program(spec, studentCode);
}

/** The signature as a human-readable line, for teacher-facing UI. */
export function signatureLabel(spec, languageKey = 'java') {
  const gen = GENERATORS[languageKey] || GENERATORS.java;
  // Harness-only parameters are not part of the signature the student sees.
  const params = callParams(spec)
    .map((p) => `${gen.typeName(p.type, spec, p)} ${p.name}`)
    .join(', ');
  return `${gen.typeName(spec.returnType, spec)} ${spec.name}(${params})`;
}

/**
 * How many stdin lines a test case must have for this signature — one JSON
 * value per parameter.
 */
export const expectedArgCount = (spec) => spec?.params?.length ?? 0;
