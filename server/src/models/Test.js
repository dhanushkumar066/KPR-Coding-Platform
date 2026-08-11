import mongoose from 'mongoose';
import { LANGUAGE_KEYS } from '../config/languages.js';

const testSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    // Per-student clock, started when they open the test. The effective deadline
    // is always min(startedAt + durationMinutes, endAt).
    durationMinutes: { type: Number, required: true, min: 1 },

    allowedLanguages: {
      type: [{ type: String, enum: LANGUAGE_KEYS }],
      default: ['python', 'cpp', 'java'],
    },

    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    // Pull N questions from the pool above; 0 = give everyone all of them.
    questionsPerStudent: { type: Number, default: 0, min: 0 },
    randomizeOrder: { type: Boolean, default: false },

    warningLimit: { type: Number, default: 3, min: 1, max: 20 },
    // On exceeding the limit we auto-submit and grade what they have — never
    // auto-zero. The teacher makes the final call via the manual override.
    terminationBehavior: {
      type: String,
      enum: ['auto_submit_and_grade'],
      default: 'auto_submit_and_grade',
    },
    graceMs: { type: Number, default: 2500, min: 0, max: 15000 },

    /**
     * How long a student may stay out of fullscreen before the attempt is
     * ended. 0 disables the deadline (fullscreen exits are then only counted as
     * ordinary warnings).
     */
    fullscreenGraceSec: { type: Number, default: 15, min: 0, max: 300 },

    // Google-verified emails permitted to sit this test.
    allowlist: [{ type: String, lowercase: true, trim: true }],

    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    isPractice: { type: Boolean, default: false },

    // Teacher controls during the exam.
    paused: { type: Boolean, default: false },
    pausedAt: { type: Date },
    // Minutes added to every student's personal deadline.
    extensionMinutes: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

testSchema.index({ allowlist: 1, status: 1 });

testSchema.methods.isOpenNow = function isOpenNow(now = new Date()) {
  return now >= this.startAt && now <= this.endAt;
};

testSchema.methods.allows = function allows(email) {
  return this.allowlist.includes(String(email || '').toLowerCase());
};

/** Metadata a student may see before/while sitting the test. */
testSchema.methods.toStudentView = function toStudentView() {
  return {
    id: this._id.toString(),
    title: this.title,
    description: this.description,
    startAt: this.startAt,
    endAt: this.endAt,
    durationMinutes: this.durationMinutes,
    allowedLanguages: this.allowedLanguages,
    warningLimit: this.warningLimit,
    graceMs: this.graceMs,
    fullscreenGraceSec: this.fullscreenGraceSec,
    isPractice: this.isPractice,
    paused: this.paused,
    questionCount: this.questionsPerStudent || this.questions.length,
  };
};

export const Test = mongoose.model('Test', testSchema);
