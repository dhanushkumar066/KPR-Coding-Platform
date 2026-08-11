import mongoose from 'mongoose';

/**
 * Cached AI feedback for one submission. Purely explanatory — nothing here ever
 * influences a score (non-negotiable #3).
 */
const reviewSchema = new mongoose.Schema(
  {
    submission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Submission',
      required: true,
      unique: true,
    },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },

    model: { type: String, default: '' },
    content: { type: String, default: '' },
    status: { type: String, enum: ['ok', 'error'], default: 'ok' },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

export const Review = mongoose.model('Review', reviewSchema);
