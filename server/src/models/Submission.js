import mongoose from 'mongoose';

/** Language and code are meaningless for an MCQ answer. */
function requiredForCoding() {
  return this.questionKind === 'coding';
}

export const VERDICTS = [
  'Pending',
  // MCQ verdicts.
  'Correct',
  'Partially Correct',
  'Incorrect',
  'Unanswered',
  // Coding verdicts.
  'Accepted',
  'Partially Accepted',
  'Wrong Answer',
  'Time Limit Exceeded',
  'Runtime Error',
  'Compile Error',
  'Judge Error',
];

const caseResultSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId },
    index: { type: Number, required: true },
    isSample: { type: Boolean, default: false },
    passed: { type: Boolean, default: false },
    verdict: { type: String, default: 'Pending' },
    points: { type: Number, default: 0 },
    earned: { type: Number, default: 0 },
    timeMs: { type: Number, default: 0 },
    memoryKb: { type: Number, default: 0 },
    // Only ever surfaced to the student for sample cases; teachers see all.
    stdout: { type: String, default: '' },
    stderr: { type: String, default: '' },
    compileOutput: { type: String, default: '' },
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'Attempt', index: true },
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // "run" = visible sample cases only, never scored.
    // "submit" = every case, scored. "auto" = produced by termination/timeout.
    kind: { type: String, enum: ['run', 'submit', 'auto'], default: 'submit', index: true },

    questionKind: { type: String, enum: ['coding', 'mcq', 'nat'], default: 'coding' },

    /** NAT answers — exactly what the student typed, before parsing. */
    natAnswer: { type: String, default: '' },

    // Coding answers.
    language: { type: String, required: requiredForCoding, default: '' },
    code: { type: String, required: requiredForCoding, default: '' },

    // MCQ answers — the option ids the student chose.
    selectedOptions: [{ type: String }],

    // Non-negotiable #4: the row exists before any grading is attempted, so a
    // judge outage can never lose a student's work.
    status: { type: String, enum: ['pending', 'graded', 'error'], default: 'pending', index: true },
    verdict: { type: String, enum: VERDICTS, default: 'Pending' },
    error: { type: String, default: '' },

    /**
     * A plain-English explanation shown above the compiler output.
     *
     * "duplicate class: Main" is accurate and useless; the hint says what was
     * actually done wrong. It never replaces the real output.
     */
    hint: { type: String, default: '' },

    results: [caseResultSchema],
    passedCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },

    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },

    maxTimeMs: { type: Number, default: 0 },
    maxMemoryKb: { type: Number, default: 0 },

    /**
     * Paste activity in this question's editor since the previous submission.
     * Summarised from the attempt's violation log at submit time, so a teacher
     * reviewing an answer can see whether it was typed or pasted in.
     */
    pasteSignals: {
      events: { type: Number, default: 0 },
      totalChars: { type: Number, default: 0 },
      largestChars: { type: Number, default: 0 },
      lastAt: { type: Date },
    },

    manualOverride: {
      score: { type: Number },
      note: { type: String, default: '' },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },

    /**
     * A student's own test input, for "Run" only.
     *
     * When set, the run executes against this instead of the sample cases and
     * is never compared to an expected output — there isn't one. It is stored
     * rather than passed through so a teacher reviewing an attempt can see what
     * the student was experimenting with.
     */
    customInput: { type: String, default: '' },

    /**
     * Idempotency key minted by the browser for one press of Run/Submit.
     *
     * If the connection drops after the server accepted the request, the
     * browser retries with the same token and gets the original submission
     * back instead of creating a second one. Without it a flaky network turns
     * one answer into several, and the "last submission" a teacher grades
     * might not be the one the student meant.
     *
     * Left unset rather than empty when absent, so the unique index below can
     * skip those documents.
     */
    clientToken: { type: String },

    gradedAt: { type: Date },
  },
  { timestamps: true }
);

submissionSchema.index({ test: 1, student: 1, question: 1, kind: 1, createdAt: -1 });

/**
 * Belt and braces for the idempotency check: two retries racing each other
 * could both find no existing submission, and this stops the second insert.
 * Partial, so the submissions that carry no token are exempt.
 */
submissionSchema.index(
  { student: 1, clientToken: 1 },
  { unique: true, partialFilterExpression: { clientToken: { $type: 'string' } } }
);

/** The score that counts — a teacher override always wins. */
submissionSchema.virtual('effectiveScore').get(function effectiveScore() {
  return typeof this.manualOverride?.score === 'number' ? this.manualOverride.score : this.score;
});

/** Redacts hidden-case I/O. Students see pass/fail for hidden cases, nothing more. */
submissionSchema.methods.toStudentView = function toStudentView() {
  return {
    id: this._id.toString(),
    question: this.question?.toString?.() ?? this.question,
    kind: this.kind,
    questionKind: this.questionKind,
    customInput: this.customInput,
    selectedOptions: this.selectedOptions,
    natAnswer: this.natAnswer,
    language: this.language,
    status: this.status,
    verdict: this.verdict,
    error: this.error,
    hint: this.hint,
    passedCount: this.passedCount,
    totalCount: this.totalCount,
    score: this.effectiveScore,
    maxScore: this.maxScore,
    maxTimeMs: this.maxTimeMs,
    maxMemoryKb: this.maxMemoryKb,
    // Shown to the student too — being told plainly that pasting is recorded is
    // both fairer and a better deterrent than catching them with it silently.
    pasteSignals: this.pasteSignals,
    createdAt: this.createdAt,
    results: this.results.map((r) => ({
      index: r.index,
      isSample: r.isSample,
      passed: r.passed,
      verdict: r.verdict,
      timeMs: r.timeMs,
      memoryKb: r.memoryKb,
      ...(r.isSample
        ? { stdout: r.stdout, stderr: r.stderr, compileOutput: r.compileOutput }
        : {}),
    })),
  };
};

export const Submission = mongoose.model('Submission', submissionSchema);
