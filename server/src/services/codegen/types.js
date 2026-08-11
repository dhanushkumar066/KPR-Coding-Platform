/**
 * The type vocabulary for function-signature ("LeetCode style") questions.
 *
 * Every type here serialises to the same canonical JSON in all five languages,
 * so one stored expected-output works no matter which language a student picks.
 *
 * `double` is the exception that proves the rule: the languages genuinely do
 * print floating point differently (`2` in JavaScript, `2.0` in Python and
 * Java, `2.000000` from a naive C `printf`). It is supported by comparing
 * numerically within a tolerance instead of as text — see
 * `answerCompare.tolerance` and `needsTolerance()` below.
 */
export const FUNCTION_TYPES = [
  'int',
  'long',
  'double',
  'boolean',
  'char',
  'string',
  'int[]',
  'long[]',
  'double[]',
  'boolean[]',
  'char[]',
  'string[]',
  'int[][]',
  'long[][]',
  'double[][]',
  'boolean[][]',
  'char[][]',
  'string[][]',
  // Node types. Written in test cases as plain arrays, exactly as LeetCode does
  // — `[1,2,3]` for a list, level-order with nulls for a tree — and turned into
  // real nodes by the harness before the student's function is called.
  'list',
  'tree',
];

/**
 * Whether a signature produces floating-point output.
 *
 * A `double` answer compared as exact text fails for reasons that have nothing
 * to do with the student, so the grader supplies a default tolerance when the
 * teacher left it at zero. This is the check that drives that.
 */
export function needsTolerance(spec) {
  if (!spec) return false;
  const isDouble = (t) => baseOf(t) === 'double';
  return isDouble(spec.returnType) || (spec.params || []).some((p) => isDouble(p?.type));
}

/** Used when a `double` question has no tolerance set. */
export const DEFAULT_TOLERANCE = 1e-6;

/**
 * Validates a class ("design") question — LRU Cache, Min Stack, Implement Trie.
 *
 * These are posed the way LeetCode poses them: the student implements a class,
 * and the test case is a list of operations with their arguments.
 *
 *   ["LRUCache","put","put","get"]
 *   [[2],[1,1],[2,2],[1]]
 *
 * expecting `[null,null,null,1]` — one entry per operation, `null` where the
 * method returns nothing (and for the constructor).
 */
export function validateClassSpec(spec) {
  const errors = [];
  if (!spec) return ['No class defined'];

  if (!IDENT.test(spec.name || '')) {
    errors.push(
      spec.name
        ? `"${spec.name}" is not a valid class name`
        : 'Give the class a name on the Answer format tab'
    );
  }

  for (const [i, p] of (spec.constructorParams || []).entries()) {
    if (!IDENT.test(p?.name || '')) errors.push(`Constructor parameter ${i + 1} needs a valid name`);
    if (!FUNCTION_TYPES.includes(p?.type)) {
      errors.push(`Constructor parameter ${p?.name || i + 1} has an unsupported type: ${p?.type}`);
    }
  }

  if (!Array.isArray(spec.methods) || spec.methods.length === 0) {
    errors.push('Add at least one method');
    return errors;
  }

  const seen = new Set();
  spec.methods.forEach((m, i) => {
    if (!IDENT.test(m?.name || '')) {
      errors.push(`Method ${i + 1} needs a valid name`);
    } else if (seen.has(m.name)) {
      // Dispatch is by name, so two methods called the same thing are
      // unresolvable no matter what their parameters look like.
      errors.push(`Duplicate method name: ${m.name} — overloads are not supported`);
    } else {
      seen.add(m.name);
    }
    if (m?.name === spec.name) {
      errors.push(`A method cannot share the class's name (${m.name})`);
    }
    if (!RETURN_TYPES.includes(m?.returnType)) {
      errors.push(`Method ${m?.name || i + 1} has an unsupported return type: ${m?.returnType}`);
    }
    // Node types would need a structure to come from, which a method call has
    // no way to name.
    if (isNodeType(m?.returnType) || (m?.params || []).some((p) => isNodeType(p?.type))) {
      errors.push(`Method ${m?.name || i + 1} cannot use list or tree types`);
    }
    (m?.params || []).forEach((p, j) => {
      if (!IDENT.test(p?.name || '')) errors.push(`${m?.name || `Method ${i + 1}`} parameter ${j + 1} needs a valid name`);
      if (!FUNCTION_TYPES.includes(p?.type)) {
        errors.push(`${m?.name || `Method ${i + 1}`} parameter ${p?.name || j + 1} has an unsupported type: ${p?.type}`);
      }
    });
  });

  return errors;
}

/**
 * LeetCode's C naming for design problems: `MyStack` becomes `myStackCreate`,
 * `myStackPush`, `myStackFree`. C has no classes, so the object is a struct
 * passed as the first argument to every function.
 */
export const cClassPrefix = (className) =>
  className ? className[0].toLowerCase() + className.slice(1) : 'obj';

export const cMethodName = (className, method) =>
  `${cClassPrefix(className)}${method[0].toUpperCase()}${method.slice(1)}`;

/**
 * Types passed to the student as linked structures rather than plain values.
 *
 * These are the reason a question like "reverse a linked list" can be asked in
 * the same LeetCode style as everything else: the teacher writes an array, the
 * student receives nodes.
 */
export const NODE_TYPES = { list: 'ListNode', tree: 'TreeNode' };

export const isNodeType = (type) => Object.hasOwn(NODE_TYPES, String(type));

/**
 * `void` is a return type only.
 *
 * It exists for the family of problems where the answer is a mutated argument
 * rather than a returned value — LeetCode's "Delete Node in a Linked List",
 * "Move Zeroes", "Rotate Image", "Merge Sorted Array". The signature declares
 * which parameter holds the answer (`outputParam`) and the harness prints that
 * after the call instead of a return value.
 */
export const RETURN_TYPES = [...FUNCTION_TYPES, 'void'];

/**
 * A single node taken from *inside* another parameter's list, located by value.
 *
 * This is how LeetCode poses "Delete Node in a Linked List": the custom test
 * supplies the whole list and the value identifying the node, but the student's
 * function receives only the node. A `node` parameter names the list it comes
 * from via `of`.
 */
export const isNodeRefType = (type) => String(type) === 'node';

/** Parameter types a teacher may choose. */
export const PARAM_TYPES = [...FUNCTION_TYPES, 'node'];

/**
 * Parameters actually passed to the student's function.
 *
 * A `harnessOnly` parameter is read from the test case and built, but withheld
 * from the signature — it exists so the harness can construct or print
 * something the student is not given directly.
 */
export const callParams = (spec) => (spec?.params || []).filter((p) => !p.harnessOnly);

/** Which node classes a signature touches, so a driver only defines what it needs. */
export function nodeTypesUsed(spec) {
  const used = new Set();
  if (isNodeType(spec?.returnType)) used.add(spec.returnType);
  for (const p of spec?.params || []) {
    if (isNodeType(p?.type)) used.add(p.type);
    // A `node` parameter is a node of whatever list it points at, so that
    // list's class is needed even when the list itself is harness-only.
    if (isNodeRefType(p?.type)) {
      const source = (spec?.params || []).find((o) => o.name === p.of);
      if (isNodeType(source?.type)) used.add(source.type);
    }
  }
  return [...used];
}

/** The parameter a `node` parameter was taken from. */
export const sourceParamFor = (spec, param) =>
  (spec?.params || []).find((p) => p.name === param?.of);

/** The parameter printed instead of a return value, when the return is `void`. */
export const outputParamFor = (spec) =>
  spec?.returnType === 'void'
    ? (spec?.params || []).find((p) => p.name === spec.outputParam)
    : undefined;

/**
 * The output parameter, but only if the student can actually see it.
 *
 * "Do not return anything, modify nums in-place instead" is helpful when `nums`
 * is in their signature and baffling when the answer is a harness-only
 * structure they were never handed — LeetCode omits the note in that case too.
 */
export function visibleOutputParam(spec) {
  const output = outputParamFor(spec);
  return output && !output.harnessOnly ? output : undefined;
}

/**
 * Languages that support function-signature mode — every language the platform
 * offers, so a question is never unusable in one of them.
 */
export const FUNCTION_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'c'];

export const baseOf = (type) => String(type).replace(/\[\]/g, '');
export const dimsOf = (type) => (String(type).match(/\[\]/g) || []).length;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validates a function spec before it is stored or used to build a program.
 * @returns {string[]} human-readable problems; empty means valid.
 */
export function validateFunctionSpec(spec) {
  const errors = [];
  if (!spec) return ['No function signature defined'];

  if (!IDENT.test(spec.name || '')) {
    errors.push(
      spec.name
        ? `"${spec.name}" is not a valid function name — use letters, digits and underscore, starting with a letter`
        : 'Give the function a name on the Answer format tab'
    );
  }
  if (!RETURN_TYPES.includes(spec.returnType)) {
    errors.push(`Unsupported return type: ${spec.returnType}`);
  }
  if (!Array.isArray(spec.params) || spec.params.length === 0) {
    errors.push('Add at least one parameter');
    return errors;
  }

  const seen = new Set();
  spec.params.forEach((p, i) => {
    if (!IDENT.test(p?.name || '')) {
      errors.push(`Parameter ${i + 1} needs a valid name`);
    } else if (seen.has(p.name)) {
      errors.push(`Duplicate parameter name: ${p.name}`);
    } else {
      seen.add(p.name);
    }
    if (!PARAM_TYPES.includes(p?.type)) {
      errors.push(`Parameter ${p?.name || i + 1} has an unsupported type: ${p?.type}`);
    }
  });

  // A `node` parameter has to say which list it comes from, and that list has to
  // be declared before it so the harness has already built it.
  spec.params.forEach((p, i) => {
    if (!isNodeRefType(p?.type)) return;
    const sourceIndex = spec.params.findIndex((o) => o.name === p.of);
    const source = spec.params[sourceIndex];
    if (!source) {
      errors.push(
        `Parameter ${p.name} is a node — set "node of" to the list or tree parameter it belongs to`
      );
    } else if (!isNodeType(source.type)) {
      errors.push(`Parameter ${p.name} is a node of ${p.of}, but ${p.of} is not a list or tree`);
    } else if (sourceIndex > i) {
      errors.push(`Parameter ${p.name} must come after ${p.of}, the structure it is taken from`);
    }
  });

  if (spec.returnType === 'void') {
    if (!spec.outputParam) {
      errors.push(
        'A void function returns nothing, so choose which parameter holds the answer — that is what gets compared against the expected output'
      );
    } else if (!spec.params.some((p) => p.name === spec.outputParam)) {
      errors.push(`"${spec.outputParam}" is not one of the parameters`);
    } else if (isNodeRefType(spec.params.find((p) => p.name === spec.outputParam)?.type)) {
      errors.push(
        `The answer parameter cannot be a single node — point it at the whole structure instead`
      );
    }
  }

  if (!callParams(spec).length) {
    errors.push('At least one parameter must be passed to the function');
  }

  return errors;
}
