import express from 'express';
import { z } from 'zod';
import { User, ROLES } from '../models/User.js';
import { Test } from '../models/Test.js';
import { Attempt } from '../models/Attempt.js';
import { Submission } from '../models/Submission.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { executorHealth } from '../services/executor.js';

/**
 * The head-of-department screens.
 *
 * An admin here is an HOD, not a college-wide superuser. They appoint the staff
 * in their own department and see their own department's results. There is no
 * tier above them by design: a college does not need one to run tests, and a
 * single college-wide account is the one worth attacking.
 *
 * The rule that keeps that honest is that an HOD may only ever act **within
 * their own department**. Without it, any HOD could appoint themselves into
 * another department and read its results — an escalation with no legitimate
 * use, since a genuinely new department's first HOD is a deploy-time event.
 */
const router = express.Router();
router.use(requireAuth, requireRole('admin'));

/**
 * An HOD who has not yet named their department cannot be scoped to anything,
 * so they can see nothing and grant nothing until they do. The client asks them
 * once at first sign-in, the same way a student confirms their own name.
 */
function requireDepartment(user) {
  if (!user.department) {
    throw new ApiError(428, 'Tell us which department you head before managing staff', {
      reason: 'department_missing',
    });
  }
  return user.department;
}

/** Staff of one department. Students are never scoped this way. */
const staffFilter = (department) => ({
  department,
  role: { $in: ['teacher', 'admin'] },
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const department = requireDepartment(req.user);
    const { search = '' } = req.query;

    const filter = staffFilter(department);
    if (search) filter.email = { $regex: String(search).slice(0, 80), $options: 'i' };

    const users = await User.find(filter).sort({ role: 1, email: 1 }).limit(500);
    res.json({
      department,
      users: users.map((u) => ({
        ...u.toPublic(),
        lastLoginAt: u.lastLoginAt,
        // An HOD chasing someone who has not turned up yet needs to tell
        // "invited" from "signed in at least once".
        signedIn: u.hasSignedIn(),
        isYou: u._id.toString() === req.user._id.toString(),
      })),
    });
  })
);

/**
 * Grants access by email, before that person has ever signed in.
 *
 * Creating the account up front rather than waiting for them means a new
 * teacher's first sign-in already lands them on the teacher screens. The old
 * way round — sign in, land on a student dashboard, telephone the HOD, get
 * promoted, refresh — is not a thing anyone should have to do on exam morning.
 */
router.post(
  '/staff',
  asyncHandler(async (req, res) => {
    const department = requireDepartment(req.user);
    const { email, role } = z
      .object({
        email: z.string().trim().toLowerCase().email('That is not an email address'),
        // An HOD may appoint a co-HOD so the department is not locked out when
        // they leave — but only inside their own department.
        role: z.enum(['teacher', 'admin']).default('teacher'),
      })
      .parse(req.body);

    const existing = await User.findOne({ email });

    if (existing) {
      if (existing.role !== 'student' && existing.department && existing.department !== department) {
        throw new ApiError(
          409,
          `${email} already belongs to ${existing.department}. Ask that department's head to release them first.`
        );
      }
      existing.role = role;
      existing.department = department;
      await existing.save();
      return res.json({ user: { ...existing.toPublic(), signedIn: existing.hasSignedIn() }, created: false });
    }

    const user = await User.create({ email, role, department, name: email.split('@')[0] });
    res.status(201).json({ user: { ...user.toPublic(), signedIn: false }, created: true });
  })
);

/**
 * Revokes access. The person keeps their account and becomes a student again;
 * their tests, questions and every result they recorded stay exactly where they
 * are, because those are college records and must outlive the member of staff
 * who happened to set them.
 */
router.delete(
  '/staff/:id',
  asyncHandler(async (req, res) => {
    const department = requireDepartment(req.user);
    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'That person is not on your staff list');

    if (user.department !== department) {
      throw new ApiError(403, 'They belong to another department');
    }
    if (user._id.toString() === req.user._id.toString()) {
      throw new ApiError(409, 'You cannot remove your own access');
    }
    if (user.role === 'admin') {
      const heads = await User.countDocuments({ department, role: 'admin' });
      if (heads <= 1) throw new ApiError(409, `${department} must keep at least one head`);
    }

    user.role = 'student';
    user.department = '';
    await user.save();
    res.json({ ok: true });
  })
);

router.patch(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const department = requireDepartment(req.user);
    const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);

    const user = await User.findById(req.params.id);
    if (!user) throw new ApiError(404, 'User not found');
    if (user.department !== department) {
      throw new ApiError(403, 'They belong to another department');
    }
    if (user._id.toString() === req.user._id.toString()) {
      throw new ApiError(409, 'You cannot change your own role');
    }
    // A department must never be left without a head.
    if (user.role === 'admin' && role !== 'admin') {
      const heads = await User.countDocuments({ department, role: 'admin' });
      if (heads <= 1) throw new ApiError(409, `${department} must keep at least one head`);
    }

    user.role = role;
    if (role === 'student') user.department = '';
    await user.save();
    res.json({ user: user.toPublic() });
  })
);

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const department = requireDepartment(req.user);

    // Everything is counted through this department's own staff, so a shared
    // first-year course counts for whichever department actually set the paper.
    const staff = await User.find(staffFilter(department)).select('_id');
    const staffIds = staff.map((s) => s._id);

    const tests = await Test.find({ createdBy: { $in: staffIds } }).select('_id');
    const testIds = tests.map((t) => t._id);

    const [teachers, heads, attempts, submissions, failedSubmissions, executor] = await Promise.all([
      User.countDocuments({ department, role: 'teacher' }),
      User.countDocuments({ department, role: 'admin' }),
      Attempt.countDocuments({ test: { $in: testIds } }),
      Submission.countDocuments({ test: { $in: testIds } }),
      Submission.countDocuments({ test: { $in: testIds }, status: 'error' }),
      executorHealth(),
    ]);

    res.json({
      department,
      teachers,
      heads,
      tests: testIds.length,
      attempts,
      submissions,
      failedSubmissions,
      // Not department-scoped, and deliberately so: the judge is shared, and an
      // HOD wants to know it is down BEFORE an exam rather than during one.
      executor,
    });
  })
);

// ---------------------------------------------------------------------------
// Department analytics
// ---------------------------------------------------------------------------

/**
 * Every student, across every paper this department has run.
 *
 * The per-test analytics a teacher sees answers "how did this paper go". A head
 * of department is asking a different question — "how is each student doing" —
 * and no amount of staring at one paper at a time answers it.
 *
 * Scoped through the department's own staff rather than by tagging students
 * with a department. A paper belongs to whoever set it, so a shared first-year
 * course counts for the department that actually ran it, and a lecturer taking
 * three branches is not a special case. Students are never tagged, because a
 * student legitimately sits papers from several departments.
 */
router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const department = requireDepartment(req.user);

    const staff = await User.find(staffFilter(department)).select('_id');
    const staffIds = staff.map((s) => s._id);

    const tests = await Test.find({ createdBy: { $in: staffIds } })
      .select('title startAt createdBy')
      .sort({ startAt: -1 });
    const testIds = tests.map((t) => t._id);

    if (!testIds.length) {
      return res.json({ department, summary: null, students: [], tests: [] });
    }

    // Only finished attempts. A paper still in progress has no meaningful score
    // yet, and counting it would drag every average down as students sit it.
    const attempts = await Attempt.find({
      test: { $in: testIds },
      status: { $ne: 'in_progress' },
    })
      .select('student studentName studentEmail studentRollNumber test score maxScore submittedAt')
      .populate('student', 'name email rollNumber');

    // Per student, across every paper they sat for this department.
    const byStudent = new Map();
    for (const a of attempts) {
      const key = a.student?._id?.toString() || a.studentEmail;
      if (!key) continue;
      if (!byStudent.has(key)) {
        byStudent.set(key, {
          id: key,
          // Snapshotted on the attempt, so a later profile edit cannot rewrite
          // who a past result belongs to.
          name: a.studentName || a.student?.name || '',
          email: a.studentEmail || a.student?.email || '',
          rollNumber: a.studentRollNumber || a.student?.rollNumber || '',
          testsTaken: 0,
          score: 0,
          maxScore: 0,
          papers: [],
        });
      }
      const s = byStudent.get(key);
      s.testsTaken += 1;
      s.score += a.score || 0;
      s.maxScore += a.maxScore || 0;
      s.papers.push({ test: a.test.toString(), score: a.score || 0, maxScore: a.maxScore || 0 });
    }

    const students = [...byStudent.values()]
      .map((s) => ({
        ...s,
        percentage: s.maxScore ? Math.round((s.score / s.maxScore) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage);

    // Per paper, so a head can see which one went badly rather than guessing
    // from individual results.
    const byTest = new Map(testIds.map((id) => [id.toString(), { sat: 0, score: 0, maxScore: 0 }]));
    for (const a of attempts) {
      const t = byTest.get(a.test.toString());
      if (!t) continue;
      t.sat += 1;
      t.score += a.score || 0;
      t.maxScore += a.maxScore || 0;
    }

    const testRows = tests.map((t) => {
      const agg = byTest.get(t._id.toString());
      return {
        id: t._id,
        title: t.title,
        startAt: t.startAt,
        sat: agg.sat,
        averagePercent: agg.maxScore ? Math.round((agg.score / agg.maxScore) * 1000) / 10 : 0,
      };
    });

    const totalScore = students.reduce((sum, s) => sum + s.score, 0);
    const totalMax = students.reduce((sum, s) => sum + s.maxScore, 0);

    res.json({
      department,
      summary: {
        tests: tests.length,
        papersSat: attempts.length,
        students: students.length,
        averagePercent: totalMax ? Math.round((totalScore / totalMax) * 1000) / 10 : 0,
        // Below 40% across everything they have sat. Named plainly rather than
        // as a grade band, because what counts as failing is the college's
        // decision and not this application's.
        below40: students.filter((s) => s.maxScore > 0 && s.percentage < 40).length,
      },
      students,
      tests: testRows,
    });
  })
);

export default router;
