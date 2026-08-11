import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MAX_IMAGE_BYTES, saveQuestionImage } from '../services/uploads.js';
import { Question } from '../models/Question.js';
import { Test } from '../models/Test.js';
import { Attempt } from '../models/Attempt.js';
import { LANGUAGE_KEYS } from '../config/languages.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { evaluate } from '../services/grader.js';
import {
  buildAllClassStubs,
  buildAllStubs,
  classLabel,
  FUNCTION_TYPES,
  PARAM_TYPES,
  RETURN_TYPES,
  signatureLabel,
  validateClassSpec,
  validateFunctionSpec,
  validateTestCases,
} from '../services/codegen/index.js';
import { inferMissingTypes, parseSignature } from '../services/codegen/parseSignature.js';
import { normaliseCaseInput } from '../services/codegen/normaliseCase.js';
import { ownershipFilter, canReach } from '../services/scope.js';
import { applyGateDefaults } from '../services/gateRules.js';
import { penaltyFor } from '../services/mcqGrader.js';

const router = express.Router();
router.use(requireAuth, requireRole('teacher', 'admin'));

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

/**
 * Uploads a diagram for a problem statement and returns the markdown to paste.
 * Teachers only — students never reach this route.
 */
router.post(
  '/images',
  imageUpload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No image uploaded');
    let saved;
    try {
      saved = await saveQuestionImage(req.file);
    } catch (err) {
      throw new ApiError(400, err.message);
    }
    res.status(201).json({ ...saved, markdown: `![diagram](${saved.url})` });
  })
);

const testCaseSchema = z.object({
  input: z.string().default(''),
  expectedOutput: z.string().default(''),
  points: z.number().min(0).default(1),
  isSample: z.boolean().default(false),
  explanation: z.string().default(''),
});

const mcqOptionSchema = z.object({
  text: z.string().default(''),
  isCorrect: z.boolean().default(false),
  explanation: z.string().default(''),
});

const questionSchema = z.object({
  kind: z.enum(['coding', 'mcq', 'nat']).default('coding'),
  // Which workspace the question belongs to. 'gate' pulls in GATE's marking
  // conventions at save time — see services/gateRules.js.
  style: z.enum(['standard', 'gate']).default('standard'),
  section: z.string().trim().max(60).default(''),
  nat: z
    .object({
      answerMin: z.number().default(0),
      answerMax: z.number().default(0),
      unit: z.string().max(16).default(''),
    })
    .default({ answerMin: 0, answerMax: 0, unit: '' }),
  mcq: z
    .object({
      multiSelect: z.boolean().default(false),
      shuffleOptions: z.boolean().default(true),
      partialCredit: z.boolean().default(true),
      negativeMarks: z.number().min(0).max(100).default(0),
      negativeFraction: z.number().min(0).max(1).default(0),
      options: z.array(mcqOptionSchema).default([]),
    })
    .default({}),
  title: z.string().trim().min(1, 'A title is required'),
  statement: z.string().default(''),
  constraints: z.string().default(''),
  inputFormat: z.string().default(''),
  outputFormat: z.string().default(''),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  tags: z.array(z.string()).default([]),
  ioMode: z.enum(['stdin', 'function', 'class']).default('function'),
  classSpec: z
    .object({
      name: z.string().default(''),
      constructorParams: z
        .array(
          z.object({
            name: z.string().default(''),
            type: z.enum([...FUNCTION_TYPES, '']).default(''),
          })
        )
        .default([]),
      methods: z
        .array(
          z.object({
            name: z.string().default(''),
            returnType: z.enum([...RETURN_TYPES, '']).default(''),
            params: z
              .array(
                z.object({
                  name: z.string().default(''),
                  type: z.enum([...FUNCTION_TYPES, '']).default(''),
                })
              )
              .default([]),
          })
        )
        .default([]),
    })
    .default({ name: '', constructorParams: [], methods: [] }),
  functionSpec: z
    .object({
      name: z.string().default(''),
      returnType: z.enum([...RETURN_TYPES, '']).default(''),
      outputParam: z.string().default(''),
      params: z
        .array(
          z.object({
            name: z.string().default(''),
            type: z.enum([...PARAM_TYPES, '']).default(''),
            harnessOnly: z.boolean().default(false),
            of: z.string().default(''),
          })
        )
        .default([]),
    })
    .default({ name: '', returnType: '', outputParam: '', params: [] }),
  answerCompare: z
    .object({
      ignoreOrder: z.boolean().default(false),
      ignoreInnerOrder: z.boolean().default(false),
      tolerance: z.number().min(0).max(1).default(0),
    })
    .default({ ignoreOrder: false, ignoreInnerOrder: false, tolerance: 0 }),
  testCases: z.array(testCaseSchema).default([]),
  timeLimitSec: z.number().min(0.5).max(20).default(2),
  memoryLimitMb: z.number().min(16).max(1024).default(256),
  marks: z.number().min(0).default(10),
  starterCode: z.record(z.string(), z.string()).default({}),
  referenceSolution: z
    .object({
      language: z.enum([...LANGUAGE_KEYS, '']).default(''),
      code: z.string().default(''),
    })
    .default({ language: '', code: '' }),
});

/**
 * A function-mode question is unusable without a valid signature — every stub
 * and the whole harness are generated from it — so reject it at the door.
 */
/**
 * Rewrites labelled test-case input into the canonical one-value-per-line form.
 *
 * A teacher copies the shape LeetCode displays — `nums = [2,7,11,15], target =
 * 9` — because that is what a question looks like to everyone who has used the
 * site. Accepting it and converting is the job; rejecting it taught nobody
 * anything.
 *
 * Mutates `merged` in place, so what gets stored is always canonical and the
 * harness never has to know this happened.
 */
function normaliseCases(merged) {
  if (merged.kind === 'mcq' || merged.ioMode !== 'function') return;
  if (!merged.functionSpec?.params?.length) return;

  merged.testCases = (merged.testCases || []).map((testCase, i) => {
    const result = normaliseCaseInput(merged.functionSpec, testCase.input);
    if (!result.ok) throw new ApiError(400, `Test case ${i + 1}: ${result.error}`);
    return result.relabelled ? { ...testCase, input: result.input } : testCase;
  });
}

/** A NAT question with no accepted range is unanswerable. */
function assertNatValid(merged) {
  const { answerMin, answerMax } = merged.nat || {};
  if (!Number.isFinite(Number(answerMin)) || !Number.isFinite(Number(answerMax))) {
    throw new ApiError(400, 'Give the numerical answer, or the range of answers you will accept');
  }
}

function assertSpecValid(merged) {
  if (merged.kind === 'nat') return assertNatValid(merged);
  if (merged.kind === 'mcq') return assertMcqValid(merged);

  if (merged.ioMode === 'class') {
    const errors = validateClassSpec(merged.classSpec);
    if (errors.length) throw new ApiError(400, errors[0], errors);
  } else if (merged.ioMode === 'function') {
    const errors = validateFunctionSpec(merged.functionSpec);
    if (errors.length) throw new ApiError(400, errors[0], errors);
    // Before the structural check, so `a = 10` becomes `10` rather than being
    // reported as unreadable.
    normaliseCases(merged);
  }

  /*
   * The test data has to be shaped the way the harness will read it.
   *
   * A description of the input sitting where a value belongs — "a=2 b=4" for a
   * two-argument function — produces a crash the student cannot do anything
   * about, and looks completely fine in the editor until then. Refusing the
   * save is the earliest honest moment to catch it.
   */
  const caseErrors = validateTestCases(merged);
  if (caseErrors.length) throw new ApiError(400, caseErrors[0], caseErrors);
}

/** An MCQ with no correct answer, or one answer on a single-select, is unusable. */
function assertMcqValid(merged) {
  const mcq = merged.mcq || {};
  const options = (mcq.options || []).filter((o) => String(o.text || '').trim());
  const correct = options.filter((o) => o.isCorrect);

  if (options.length < 2) throw new ApiError(400, 'Add at least two options');
  if (!correct.length) throw new ApiError(400, 'Mark at least one option as correct');
  if (!mcq.multiSelect && correct.length > 1) {
    throw new ApiError(
      400,
      'This is a single-answer question but more than one option is marked correct — turn on "more than one answer" or unmark the extras'
    );
  }
  if (correct.length === options.length) {
    throw new ApiError(400, 'Every option is marked correct — the question has no wrong answer');
  }
}

/** Teachers see only their own content; admins see everything. */
// Department-scoped: see services/scope.js.

async function loadOwned(id, user) {
  const question = await Question.findById(id);
  if (!question) throw new ApiError(404, 'Question not found');
  if (!(await canReach(user, question.createdBy))) {
    throw new ApiError(403, 'This question belongs to another teacher');
  }
  return question;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { search = '', difficulty, tag, kind, style } = req.query;
    const filter = { ...(await ownershipFilter(req.user)) };
    if (difficulty) filter.difficulty = difficulty;
    if (kind) filter.kind = kind;
    // Questions written before `style` existed have no such field on disk, even
    // though reading one back reports the schema default. Querying for
    // 'standard' must therefore also match documents where it is absent, or
    // every question predating this field silently disappears from the tab.
    // `null` inside $in also matches documents where the field is absent, which
    // keeps this off `$or` — that key belongs to the ownership filter, and
    // quietly overwriting it would show one teacher another's questions.
    if (style === 'standard') filter.style = { $in: ['standard', null] };
    else if (style) filter.style = style;
    if (tag) filter.tags = tag;
    if (search) filter.title = { $regex: String(search).slice(0, 80), $options: 'i' };

    const questions = await Question.find(filter).sort({ updatedAt: -1 }).limit(200);
    res.json({
      questions: questions.map((q) => ({
        id: q._id,
        title: q.title,
        difficulty: q.difficulty,
        marks: q.marks,
        tags: q.tags,
        kind: q.kind,
        style: q.style,
        section: q.section,
        // Enough for the library to describe an MCQ or NAT without a second
        // request: how many options, how many are right, and what it costs.
        optionCount: q.kind === 'mcq' ? q.mcq?.options?.length || 0 : 0,
        correctCount: q.kind === 'mcq' ? (q.mcq?.options || []).filter((o) => o.isCorrect).length : 0,
        multiSelect: q.kind === 'mcq' ? Boolean(q.mcq?.multiSelect) : false,
        penalty: q.kind === 'mcq' ? penaltyFor(q) : 0,
        natRange: q.kind === 'nat' ? { min: q.nat?.answerMin, max: q.nat?.answerMax, unit: q.nat?.unit } : null,
        caseCount: q.testCases.length,
        sampleCount: q.testCases.filter((c) => c.isSample).length,
        // 'passed' | 'failed' | 'unchecked'. Only 'failed' — or unreadable test
        // data — blocks a test from publishing.
        check: q.verificationState(),
        caseProblems: validateTestCases(q).length,
        updatedAt: q.updatedAt,
      })),
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = applyGateDefaults(questionSchema.parse(req.body));
    assertSpecValid(data);
    const question = await Question.create({ ...data, createdBy: req.user._id });
    res.status(201).json({ question });
  })
);

/**
 * Live preview of the per-language starter code a signature produces. Keeps the
 * teacher UI from reimplementing (and drifting from) the real generator.
 */
/**
 * Reads a pasted signature into a spec, filling any types it could not state
 * from a sample test case.
 *
 * This is what keeps a teacher from assembling a signature out of dropdowns:
 * they paste the line they already have and correct it if needed.
 */
router.post(
  '/parse-signature',
  asyncHandler(async (req, res) => {
    const { source, sampleInput, sampleOutput } = z
      .object({
        source: z.string().max(2000),
        sampleInput: z.string().max(20_000).default(''),
        sampleOutput: z.string().max(20_000).default(''),
      })
      .parse(req.body);

    const parsed = parseSignature(source);
    if (!parsed.ok) return res.json({ ok: false, error: parsed.error });

    // A JavaScript signature carries no types at all, and a teacher may paste
    // an untyped line — the test case they already wrote fills the gaps.
    const spec =
      parsed.unknown.length || !parsed.returnTypeKnown
        ? inferMissingTypes(parsed.spec, sampleInput, sampleOutput)
        : parsed.spec;

    const errors = validateFunctionSpec(spec);

    res.json({
      ok: true,
      spec,
      // Named so the UI can say which types were a guess rather than read.
      inferred: parsed.unknown,
      returnTypeInferred: !parsed.returnTypeKnown,
      errors,
    });
  })
);

router.post(
  '/preview-stubs',
  asyncHandler(async (req, res) => {
    // A class question previews from classSpec instead; the shape of the
    // response is the same so the editor renders both the same way.
    if (req.body?.classSpec) {
      const spec = questionSchema.shape.classSpec.parse(req.body.classSpec);
      const errors = validateClassSpec(spec);
      if (errors.length) return res.json({ ok: false, errors, stubs: {} });

      return res.json({
        ok: true,
        errors: [],
        stubs: buildAllClassStubs(spec),
        signature: classLabel(spec),
        // Operations and their arguments — always two lines.
        argCount: 2,
      });
    }

    const spec = questionSchema.shape.functionSpec.parse(req.body?.functionSpec);
    const errors = validateFunctionSpec(spec);
    if (errors.length) return res.json({ ok: false, errors, stubs: {} });

    res.json({
      ok: true,
      errors: [],
      stubs: buildAllStubs(spec),
      signature: signatureLabel(spec),
      argCount: spec.params.length,
    });
  })
);

/**
 * Where this question is currently in use. Editing one that a running test
 * depends on changes what students are being graded against mid-exam, so the
 * editor warns rather than discovering it afterwards.
 */
async function usageOf(question) {
  const now = new Date();
  const liveTests = await Test.find({
    questions: question._id,
    status: 'published',
    startAt: { $lte: now },
    endAt: { $gte: now },
  }).select('title');

  const liveAttempts = liveTests.length
    ? await Attempt.countDocuments({
        test: { $in: liveTests.map((t) => t._id) },
        status: 'in_progress',
      })
    : 0;

  return {
    testCount: await Test.countDocuments({ questions: question._id }),
    liveTests: liveTests.map((t) => ({ id: t._id, title: t.title })),
    studentsSittingNow: liveAttempts,
  };
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const question = await loadOwned(req.params.id, req.user);
    res.json({
      question,
      check: question.verificationState(),
      checkNote: question.verification?.note || '',
      usage: await usageOf(question),
    });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const question = await loadOwned(req.params.id, req.user);
    const data = questionSchema.partial().parse(req.body);
    question.set(data);
    applyGateDefaults(question);
    // Validate the merged document, not just the patch — the mode may be
    // arriving in this request while the signature came in an earlier one.
    assertSpecValid(question);
    await question.save();
    res.json({ question });
  })
);

router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const source = await loadOwned(req.params.id, req.user);
    const copy = source.toObject();
    delete copy._id;
    delete copy.createdAt;
    delete copy.updatedAt;
    const question = await Question.create({
      ...copy,
      title: `${source.title} (copy)`,
      createdBy: req.user._id,
    });
    res.status(201).json({ question });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const question = await loadOwned(req.params.id, req.user);

    // Refuse to orphan a question that a test still points at.
    const usedBy = await Test.countDocuments({ questions: question._id });
    if (usedBy > 0) {
      throw new ApiError(
        409,
        `This question is used by ${usedBy} test${usedBy === 1 ? '' : 's'} — remove it from them first`
      );
    }

    await question.deleteOne();
    res.json({ ok: true });
  })
);

/**
 * Runs the teacher's reference solution against the stored cases so they can
 * confirm the expected outputs are right before students ever see them.
 */
router.post(
  '/:id/verify-reference',
  asyncHandler(async (req, res) => {
    const question = await loadOwned(req.params.id, req.user);
    const { language, code } = question.referenceSolution || {};
    if (!language || !code?.trim()) {
      throw new ApiError(400, 'Add a reference solution first');
    }
    if (!question.testCases.length) throw new ApiError(400, 'Add at least one test case first');

    const outcome = await evaluate({
      languageKey: language,
      code,
      cases: question.testCases,
      timeLimitSec: question.timeLimitSec,
      memoryLimitMb: question.memoryLimitMb,
      functionSpec: question.ioMode === 'function' ? question.functionSpec : null,
      marks: question.marks,
      scored: false,
    });

    // Only a clean sweep counts. A partial pass means at least one case is not
    // answerable as written, and is recorded as a failure rather than thrown
    // away — a failed check is what blocks publishing.
    const allPassed = outcome.passedCount === outcome.totalCount && outcome.totalCount > 0;
    question.verification = {
      at: new Date(),
      ok: allPassed,
      signature: question.answerabilitySignature(),
      note: allPassed
        ? `passed ${outcome.passedCount}/${outcome.totalCount}`
        : `${outcome.verdict} — ${outcome.passedCount}/${outcome.totalCount} passed`,
    };
    await question.save();

    res.json({
      verdict: outcome.verdict,
      passedCount: outcome.passedCount,
      totalCount: outcome.totalCount,
      verified: allPassed,
      results: outcome.results.map((r) => ({
        index: r.index,
        passed: r.passed,
        verdict: r.verdict,
        stdout: r.stdout,
        stderr: r.stderr,
        compileOutput: r.compileOutput,
        timeMs: r.timeMs,
      })),
    });
  })
);

/**
 * Enhancement (§6): runs the reference solution over teacher-supplied inputs to
 * produce candidate expected outputs. Nothing is stored until the teacher
 * reviews and saves them — grading always uses the approved cases.
 */
router.post(
  '/:id/generate-outputs',
  asyncHandler(async (req, res) => {
    const question = await loadOwned(req.params.id, req.user);
    const { inputs } = z.object({ inputs: z.array(z.string()).min(1).max(50) }).parse(req.body);

    const { language, code } = question.referenceSolution || {};
    if (!language || !code?.trim()) {
      throw new ApiError(400, 'Add a reference solution before generating outputs');
    }

    const outcome = await evaluate({
      languageKey: language,
      code,
      cases: inputs.map((input) => ({ input, expectedOutput: '', points: 1 })),
      timeLimitSec: question.timeLimitSec,
      memoryLimitMb: question.memoryLimitMb,
      functionSpec: question.ioMode === 'function' ? question.functionSpec : null,
      marks: 0,
      scored: false,
    });

    res.json({
      candidates: outcome.results.map((r, i) => ({
        input: inputs[i],
        expectedOutput: r.stdout,
        ok: r.verdict === 'Wrong Answer' || r.verdict === 'Accepted',
        verdict: r.verdict,
        stderr: r.stderr,
        compileOutput: r.compileOutput,
      })),
    });
  })
);

export default router;
