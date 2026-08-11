import express from 'express';
import rateLimit from 'express-rate-limit';
import { Attempt } from '../models/Attempt.js';
import { Submission } from '../models/Submission.js';
import { Question } from '../models/Question.js';
import { Review } from '../models/Review.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';
import { requireAuth } from '../middleware/auth.js';
import { generateReview, isAiReviewConfigured } from '../services/aiReview.js';

const router = express.Router();
router.use(requireAuth);

const reviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many review requests — wait a minute' },
});

router.get('/status', (_req, res) => {
  res.json({ available: isAiReviewConfigured() });
});

/**
 * Generates (or returns the cached) AI review for one submission.
 *
 * Hard gate: the attempt must be over. A student cannot use this as a hint
 * machine mid-exam (§7 — "Must be disabled during the test").
 */
router.post(
  '/submissions/:submissionId',
  reviewLimiter,
  asyncHandler(async (req, res) => {
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) throw new ApiError(404, 'Submission not found');

    const isOwner = submission.student.toString() === req.user._id.toString();
    const isStaff = ['teacher', 'admin'].includes(req.user.role);
    if (!isOwner && !isStaff) throw new ApiError(403, 'Not your submission');

    const attempt = await Attempt.findById(submission.attempt).select('status');
    if (!attempt) throw new ApiError(404, 'Attempt not found');
    if (attempt.status === 'in_progress') {
      throw new ApiError(
        403,
        'AI review is only available once your attempt is finished'
      );
    }

    const cached = await Review.findOne({ submission: submission._id });
    if (cached && cached.status === 'ok') {
      return res.json({ review: { content: cached.content, model: cached.model, cached: true } });
    }

    const question = await Question.findById(submission.question);
    if (!question) throw new ApiError(404, 'The question no longer exists');

    const outcome = await generateReview({ question, submission });
    if (!outcome.ok) throw new ApiError(503, outcome.error);

    await Review.findOneAndUpdate(
      { submission: submission._id },
      {
        submission: submission._id,
        student: submission.student,
        test: submission.test,
        question: submission.question,
        model: outcome.model,
        content: outcome.content,
        status: 'ok',
        error: '',
      },
      { upsert: true, new: true }
    );

    res.json({ review: { content: outcome.content, model: outcome.model, cached: false } });
  })
);

export default router;
