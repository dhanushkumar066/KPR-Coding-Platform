import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { LANGUAGE_KEYS } from '../config/languages.js';
import { labelCaseInput } from '../services/codegen/normaliseCase.js';
import { penaltyFor } from '../services/mcqGrader.js';
import {
  buildClassStub,
  buildStub,
  FUNCTION_TYPES,
  PARAM_TYPES,
  RETURN_TYPES,
  stdinStub,
  supportsFunctionMode,
} from '../services/codegen/index.js';

/**
 * A single graded case. `isSample` cases are the only ones ever shown to a
 * student (and the only ones "Run" executes); everything else is hidden.
 * `points` gives each case its own weight so partial scoring is possible.
 */
const testCaseSchema = new mongoose.Schema(
  {
    input: { type: String, default: '' },
    expectedOutput: { type: String, default: '' },
    points: { type: Number, default: 1, min: 0 },
    isSample: { type: Boolean, default: false },
    explanation: { type: String, default: '' },
  },
  { _id: true }
);

const mcqOptionSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    isCorrect: { type: Boolean, default: false },
    // Shown only after the attempt is over.
    explanation: { type: String, default: '' },
  },
  { _id: true }
);

const questionSchema = new mongoose.Schema(
  {
    // A test may mix both kinds freely.
    /**
     * `nat` is GATE's Numerical Answer Type: the student types a number rather
     * than choosing an option, and it is never negatively marked.
     */
    kind: { type: String, enum: ['coding', 'mcq', 'nat'], default: 'coding', index: true },

    /**
     * Which workspace this question was written for.
     *
     * `gate` is not decoration: it changes the marking conventions a teacher
     * gets by default (MCQ loses a third of its marks, MSQ and NAT lose
     * nothing) and it gives the question a paper section. Keeping it explicit
     * rather than inferring "looks GATE-ish" from the negative marking means a
     * plain class-test MCQ never silently acquires negative marking, and a GATE
     * question never silently loses it.
     */
    style: { type: String, enum: ['standard', 'gate'], default: 'standard', index: true },

    /**
     * GATE's paper section — "General Aptitude" or the core subject. GATE papers
     * are 15 marks of aptitude plus 85 of the subject, and candidates expect the
     * two to be navigable separately.
     */
    section: { type: String, default: '', trim: true, maxlength: 60 },

    nat: {
      /**
       * The accepted answer, as a range.
       *
       * GATE publishes its NAT answers as "2.4 to 2.6" rather than a single
       * figure, because a question involving division has no one right decimal
       * expansion. An exact answer is a range of zero width.
       */
      answerMin: { type: Number, default: 0 },
      answerMax: { type: Number, default: 0 },
      /** Shown beside the input — "ms", "kB". Display only, never compared. */
      unit: { type: String, default: '', trim: true, maxlength: 16 },
    },

    mcq: {
      multiSelect: { type: Boolean, default: false },
      // Different option order per student, so neighbours cannot copy "it's B".
      shuffleOptions: { type: Boolean, default: true },
      // Multi-select only: credit for each correct option, minus wrong picks.
      partialCredit: { type: Boolean, default: true },
      // Deducted for a wrong answer, as a flat number of marks. 0 disables it.
      negativeMarks: { type: Number, default: 0, min: 0 },

      /**
       * Deduction as a fraction of this question's own marks — GATE's scheme.
       *
       * GATE takes 1/3 off a 1-mark question and 2/3 off a 2-mark one, so one
       * setting stays proportionate across a paper that mixes weights. Stored
       * as the fraction itself (1/3 → 0.3333), and it wins over `negativeMarks`
       * when both are set, being the more specific instruction.
       */
      negativeFraction: { type: Number, default: 0, min: 0, max: 1 },
      options: [mcqOptionSchema],
    },

    title: { type: String, required: true, trim: true },
    statement: { type: String, default: '' },
    constraints: { type: String, default: '' },
    inputFormat: { type: String, default: '' },
    outputFormat: { type: String, default: '' },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'easy' },
    tags: [{ type: String, trim: true }],

    /**
     * `function` — LeetCode style, and the default: the student implements one
     *              function against a signature, and a generated harness feeds
     *              it the arguments and prints the return value.
     * `stdin`    — the student writes a whole program that reads stdin and
     *              prints to stdout. The escape hatch for problems the type
     *              system cannot express.
     *
     * Legacy questions were pinned to `stdin` explicitly by
     * scripts/migrateIoMode.js, so this default only applies to new ones.
     */
    /**
     * `class` — a design problem: the student implements a class and the
     *           harness replays a list of operations against it, exactly as
     *           LeetCode poses "LRU Cache" and "Min Stack".
     */
    ioMode: { type: String, enum: ['stdin', 'function', 'class'], default: 'function' },

    classSpec: {
      name: { type: String, default: '' },
      constructorParams: [
        {
          _id: false,
          name: { type: String, default: '' },
          type: { type: String, enum: [...FUNCTION_TYPES, ''], default: '' },
        },
      ],
      methods: [
        {
          _id: false,
          name: { type: String, default: '' },
          returnType: { type: String, enum: [...RETURN_TYPES, ''], default: '' },
          params: [
            {
              _id: false,
              name: { type: String, default: '' },
              type: { type: String, enum: [...FUNCTION_TYPES, ''], default: '' },
            },
          ],
        },
      ],
    },

    functionSpec: {
      name: { type: String, default: '' },
      returnType: { type: String, enum: [...RETURN_TYPES, ''], default: '' },
      /**
       * `void` only: the parameter whose final state is the answer, compared
       * against the expected output in place of a return value.
       */
      outputParam: { type: String, default: '' },
      params: [
        {
          _id: false,
          name: { type: String, default: '' },
          type: { type: String, enum: [...PARAM_TYPES, ''], default: '' },
          /** Built by the harness but withheld from the student's signature. */
          harnessOnly: { type: Boolean, default: false },
          /** `node` only: the list or tree parameter this node is taken from. */
          of: { type: String, default: '' },
        },
      ],
    },

    /**
     * How a student's answer is compared with the expected output.
     *
     * Exact text by default. The switches exist for the questions where exact
     * text would mark a correct answer wrong — see utils/normalize.js.
     */
    answerCompare: {
      /** The answer is a set, not a sequence: "3Sum", "Group Anagrams". */
      ignoreOrder: { type: Boolean, default: false },
      /** Also within each element: "3Sum" yes, "Permutations" no. */
      ignoreInnerOrder: { type: Boolean, default: false },
      /** Numbers need only be this close. Required for floating-point answers. */
      tolerance: { type: Number, default: 0, min: 0 },
    },

    testCases: [testCaseSchema],

    timeLimitSec: { type: Number, default: 2, min: 0.5, max: 20 },
    memoryLimitMb: { type: Number, default: 256, min: 16, max: 1024 },
    marks: { type: Number, default: 10, min: 0 },

    // Per-language starter stubs, keyed by language key.
    starterCode: {
      type: Map,
      of: String,
      default: () => new Map(),
    },

    referenceSolution: {
      language: { type: String, enum: [...LANGUAGE_KEYS, ''], default: '' },
      code: { type: String, default: '' },
    },

    /**
     * The result of the last time this question was run against its own test
     * cases, if it ever was.
     *
     * Three states matter, and they are treated very differently:
     *
     *   - **passed** — a correct solution scores every case. Nothing to do.
     *   - **failed** — a solution was run and did *not* pass. That is positive
     *     evidence the question is broken, so publishing is blocked.
     *   - **never checked** — no evidence either way. Publishing is allowed
     *     with a warning: writing a reference solution for every question is
     *     real work, and a teacher is entitled to decide a question is obvious.
     *
     * `signature` is a digest of everything that could invalidate the result —
     * the mode, the spec, the cases, the solution — so editing any of them
     * discards it rather than leaving a stale verdict.
     */
    verification: {
      at: { type: Date, default: null },
      ok: { type: Boolean, default: false },
      signature: { type: String, default: '' },
      note: { type: String, default: '' },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Questions in the library are reusable across tests and semesters.
    inLibrary: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

questionSchema.virtual('totalPoints').get(function totalPoints() {
  return this.testCases.reduce((sum, tc) => sum + (tc.points || 0), 0);
});

/**
 * Digest of everything a verification result depends on.
 *
 * Anything that could turn a passing question into a failing one belongs here.
 * Presentation — title, statement, tags, marks — deliberately does not, so
 * fixing a typo in the wording does not force a teacher to re-run the check.
 */
questionSchema.methods.answerabilitySignature = function answerabilitySignature() {
  /*
   * Every field is read explicitly with a default rather than by serialising
   * the subdocuments wholesale.
   *
   * A Mongoose document only materialises schema defaults when it is saved, so
   * hashing the raw subdocuments gave one value before `save()` and a different
   * one after reloading — which quietly invalidated every stamp the moment it
   * was written. Normalising here makes the hash depend on the question rather
   * than on how far through its lifecycle the document happens to be.
   */
  const spec = this.functionSpec || {};
  const cls = this.classSpec || {};
  const cmp = this.answerCompare || {};

  const relevant = {
    ioMode: this.ioMode || 'stdin',
    timeLimitSec: this.timeLimitSec ?? 0,
    compare: {
      ignoreOrder: Boolean(cmp.ignoreOrder),
      ignoreInnerOrder: Boolean(cmp.ignoreInnerOrder),
      tolerance: Number(cmp.tolerance || 0),
    },
    cases: (this.testCases || []).map((c) => [String(c.input ?? ''), String(c.expectedOutput ?? '')]),
    reference: [
      String(this.referenceSolution?.language || ''),
      String(this.referenceSolution?.code || ''),
    ],
    functionSpec:
      this.ioMode === 'function'
        ? {
            name: String(spec.name || ''),
            returnType: String(spec.returnType || ''),
            outputParam: String(spec.outputParam || ''),
            params: (spec.params || []).map((p) => [
              String(p.name || ''),
              String(p.type || ''),
              Boolean(p.harnessOnly),
              String(p.of || ''),
            ]),
          }
        : null,
    classSpec:
      this.ioMode === 'class'
        ? {
            name: String(cls.name || ''),
            constructorParams: (cls.constructorParams || []).map((p) => [
              String(p.name || ''),
              String(p.type || ''),
            ]),
            methods: (cls.methods || []).map((m) => [
              String(m.name || ''),
              String(m.returnType || ''),
              (m.params || []).map((p) => [String(p.name || ''), String(p.type || '')]),
            ]),
          }
        : null,
  };

  return createHash('sha1').update(JSON.stringify(relevant)).digest('hex');
};

/** Whether the stored verdict still describes this question as it is now. */
questionSchema.methods.verificationState = function verificationState() {
  if (this.kind !== 'coding') return 'passed';
  const v = this.verification || {};
  if (!v.at || !v.signature) return 'unchecked';
  if (v.signature !== this.answerabilitySignature()) return 'unchecked';
  return v.ok ? 'passed' : 'failed';
};

/** True when a correct solution is known to score every case. */
questionSchema.methods.isVerified = function isVerified() {
  return this.verificationState() === 'passed';
};

/**
 * True when someone ran the check and it did not pass.
 *
 * This is the only verification result that blocks publishing: it is evidence
 * the question is broken, rather than merely an absence of evidence that it
 * works.
 */
questionSchema.methods.failedVerification = function failedVerification() {
  return this.verificationState() === 'failed';
};

/**
 * Deterministic shuffle from a seed string, so a student sees the same option
 * order every time they reload — but a different one from their neighbour.
 */
function seededShuffle(items, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 48271) + 11) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** What a student is allowed to see: samples only, never hidden cases. */
questionSchema.methods.toStudentView = function toStudentView(allowedLanguages, seed = '') {
  if (this.kind === 'nat') {
    return {
      id: this._id.toString(),
      kind: 'nat',
      style: this.style,
      section: this.section,
      title: this.title,
      statement: this.statement,
      difficulty: this.difficulty,
      marks: this.marks,
      // The accepted range is the answer key, so it never leaves the server.
      // Only the unit does, because it belongs next to the input box.
      nat: { unit: this.nat?.unit || '' },
    };
  }

  if (this.kind === 'mcq') {
    // `isCorrect` and the per-option explanation are deliberately absent — the
    // answer key must never reach the browser during an exam.
    const options = this.mcq.options.map((o) => ({ id: o._id.toString(), text: o.text }));
    return {
      id: this._id.toString(),
      kind: 'mcq',
      style: this.style,
      section: this.section,
      title: this.title,
      statement: this.statement,
      difficulty: this.difficulty,
      marks: this.marks,
      mcq: {
        multiSelect: this.mcq.multiSelect,
        // The deduction already resolved to marks, however it was configured.
        // A student deciding whether to guess should not have to work out what
        // "one third of two marks" comes to under exam pressure.
        penalty: penaltyFor(this),
        partialCredit: this.mcq.partialCredit,
        optionCount: options.length,
        correctCount: this.mcq.multiSelect
          ? this.mcq.options.filter((o) => o.isCorrect).length
          : 1,
      },
      options: this.mcq.shuffleOptions ? seededShuffle(options, `${seed}:${this._id}`) : options,
    };
  }

  const starter = {};

  if (this.ioMode === 'class' && this.classSpec?.name) {
    for (const key of allowedLanguages || []) {
      if (supportsFunctionMode(key)) starter[key] = buildClassStub(this.classSpec, key);
    }
  } else if (this.ioMode === 'function' && this.functionSpec?.name) {
    // Generated from the signature, so the student always opens onto code that
    // already compiles and has their arguments in scope.
    for (const key of allowedLanguages || []) {
      if (supportsFunctionMode(key)) starter[key] = buildStub(this.functionSpec, key);
    }
  } else {
    // Standard input/output. Fall back to the language's read-stdin skeleton so
    // the student never faces an empty editor, and let a teacher's own starter
    // code override it.
    for (const key of allowedLanguages || []) starter[key] = stdinStub(key);

    for (const [k, v] of this.starterCode?.entries?.() || []) {
      if (!allowedLanguages || allowedLanguages.includes(k)) starter[k] = v;
    }
  }

  return {
    kind: 'coding',
    style: this.style,
    section: this.section,
    ioMode: this.ioMode,
    functionSpec:
      this.ioMode === 'function'
        ? {
            name: this.functionSpec.name,
            returnType: this.functionSpec.returnType,
            params: this.functionSpec.params.map((p) => ({ name: p.name, type: p.type })),
          }
        : null,
    classSpec:
      this.ioMode === 'class'
        ? {
            name: this.classSpec.name,
            constructorParams: this.classSpec.constructorParams.map((p) => ({
              name: p.name,
              type: p.type,
            })),
            methods: this.classSpec.methods.map((m) => ({
              name: m.name,
              returnType: m.returnType,
              params: m.params.map((p) => ({ name: p.name, type: p.type })),
            })),
          }
        : null,
    id: this._id.toString(),
    title: this.title,
    statement: this.statement,
    constraints: this.constraints,
    inputFormat: this.inputFormat,
    outputFormat: this.outputFormat,
    difficulty: this.difficulty,
    marks: this.marks,
    timeLimitSec: this.timeLimitSec,
    memoryLimitMb: this.memoryLimitMb,
    starterCode: starter,
    samples: this.testCases
      .filter((tc) => tc.isSample)
      .map((tc) => ({
        id: tc._id.toString(),
        input: tc.input,
        // The same values written the way LeetCode displays them —
        // `nums = [2,7,11,15], target = 9`. Students recognise this instantly;
        // two bare lines take a moment to map onto the signature.
        labelledInput:
          this.ioMode === 'function' ? labelCaseInput(this.functionSpec, tc.input) : null,
        expectedOutput: tc.expectedOutput,
        explanation: tc.explanation,
      })),
    hiddenCaseCount: this.testCases.filter((tc) => !tc.isSample).length,
  };
};

export const Question = mongoose.model('Question', questionSchema);
