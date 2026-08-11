import mongoose from 'mongoose';

export const VIOLATION_TYPES = [
  'tab_switch',
  'window_blur',
  'fullscreen_exit',
  'large_paste',
  'copy',
  'paste',
  'context_menu',
  'devtools_suspected',
  // Screenshot / screen-capture key signals.
  'screenshot_key',
  'snip_tool',
  // The page went hidden without the window ever losing focus — the signature
  // of a system overlay drawn on top of the page (Circle to Search, Windows
  // Click to Do, an assistant panel) rather than a deliberate tab change.
  'screen_overlay',
  'print_attempt',
  'save_page_attempt',
  'view_source_attempt',
  // Fullscreen re-entry deadline.
  'fullscreen_restored',
  'fullscreen_deadline_missed',
  // Focus was gone when polled, without a `blur` event ever arriving. This is
  // what a floating or always-on-top window looks like: it takes focus but the
  // page stays "visible", so neither of the usual signals fires.
  'focus_lost_silently',
  // The student has more than one display. Not a violation on its own — plenty
  // of people have a second monitor — but it is where a floating window of
  // notes would sit, so a teacher should be able to see it.
  'second_screen',
];

/**
 * Every reported event is stored, whether or not it counted as a strike. The
 * `counted` flag records the server's decision so a teacher reviewing the log
 * can see exactly why a student was (or wasn't) penalised.
 */
const violationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: VIOLATION_TYPES, required: true },
    at: { type: Date, default: Date.now },
    durationMs: { type: Number, default: 0 },
    counted: { type: Boolean, default: false },
    reason: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const draftSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    language: { type: String, default: '' },
    code: { type: String, default: '' },
    // MCQ selections live in the same draft slot as code, so autosave, resume
    // after a crash, and grading-on-finish all work the same for both kinds.
    selectedOptions: [{ type: String }],
    // NAT: exactly what the student typed, kept verbatim so a teacher can see
    // a mistyped answer rather than a silently coerced number.
    natAnswer: { type: String, default: '' },

    /**
     * The student's own bookmark — GATE's "Mark for Review".
     *
     * Purely a navigation aid. GATE evaluates a marked question exactly like
     * any other, and so does this: nothing in grading reads this field, which
     * is the point. Students routinely believe marking forfeits the answer, so
     * it matters that it demonstrably cannot.
     */
    markedForReview: { type: Boolean, default: false },

    /** Whether the student has opened this question — GATE's "Not Visited". */
    visited: { type: Boolean, default: false },

    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const attemptSchema = new mongoose.Schema(
  {
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    studentEmail: { type: String, lowercase: true, index: true },

    // Snapshotted at the moment the attempt starts, so a later profile edit
    // cannot rewrite who a past result belongs to.
    studentName: { type: String, default: '' },
    studentRollNumber: { type: String, default: '' },

    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'auto_submitted', 'terminated'],
      default: 'in_progress',
      index: true,
    },

    startedAt: { type: Date, default: Date.now },
    // Personal deadline, recomputed when a teacher extends or pauses.
    endsAt: { type: Date, required: true },
    submittedAt: { type: Date },

    // The exact question set and order this student was given.
    questionOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],

    // One active session per student per test. A new device may only take over
    // once the previous one has stopped sending heartbeats (i.e. it crashed).
    sessionId: { type: String, default: '' },
    lastHeartbeatAt: { type: Date, default: Date.now },

    /**
     * When the student left fullscreen, or null while they are in it. The
     * server, not the browser, decides when the re-entry deadline has passed.
     */
    fullscreenExitAt: { type: Date, default: null },

    /**
     * Whether fullscreen was ever successfully granted. A browser that refuses
     * the request (or a device that has no fullscreen) must not get the student
     * thrown out of an exam they were never able to enter properly.
     */
    fullscreenEverEntered: { type: Boolean, default: false },

    warnings: { type: Number, default: 0 },
    violations: [violationSchema],
    terminatedReason: { type: String, default: '' },

    drafts: [draftSchema],

    /**
     * Audit trail for teacher interventions — letting a student back in after a
     * termination, or handing them extra questions mid-test. Kept alongside the
     * violation log so the two can be read together.
     */
    interventions: [
      {
        _id: false,
        type: { type: String, enum: ['reinstated', 'question_added'] },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: { type: String, default: '' },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    score: { type: Number, default: 0 },

    /**
     * The true total, negative marking and all, before `score` is floored at
     * zero for the mark sheet. Zero-on-the-record and minus-seven-in-fact are
     * different results, and only this field can tell them apart.
     */
    rawScore: { type: Number, default: 0 },

    maxScore: { type: Number, default: 0 },
    gradedAt: { type: Date },
  },
  { timestamps: true }
);

attemptSchema.index({ test: 1, student: 1 }, { unique: true });

attemptSchema.methods.isActive = function isActive() {
  return this.status === 'in_progress';
};

attemptSchema.methods.isLocked = function isLocked() {
  return this.status === 'terminated';
};

attemptSchema.methods.timeRemainingMs = function timeRemainingMs(now = new Date()) {
  return Math.max(0, this.endsAt.getTime() - now.getTime());
};

attemptSchema.methods.toStudentView = function toStudentView(now = new Date()) {
  return {
    id: this._id.toString(),
    status: this.status,
    startedAt: this.startedAt,
    endsAt: this.endsAt,
    timeRemainingMs: this.timeRemainingMs(now),
    warnings: this.warnings,
    sessionId: this.sessionId,
    score: this.status === 'in_progress' ? undefined : this.score,
    maxScore: this.status === 'in_progress' ? undefined : this.maxScore,
  };
};

export const Attempt = mongoose.model('Attempt', attemptSchema);
