import express from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';
import { issueSession, clearSession, requireAuth } from '../middleware/auth.js';

const router = express.Router();
const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

/**
 * Rate-limited per account, not per IP.
 *
 * A whole computer lab shares one public address, so an IP-keyed limiter would
 * lock out an entire class the moment they all signed in at the start of an
 * exam — which is exactly when they must not be locked out. Keying on the email
 * still blunts credential stuffing against any single account.
 *
 * Successful sign-ins are not counted at all: only repeated *failures* are
 * suspicious.
 */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    // Google sign-in posts a credential rather than an email, so those fall
    // back to the address — but the Google token itself is the real gate there.
    return email || `ip:${req.ip}`;
  },
  // The key is deliberately the email, not req.ip, so silence the built-in
  // check that expects an IP-derived key.
  validate: { ip: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed sign-in attempts for this account — wait a few minutes' },
});

/**
 * Decides the role for an email at first sign-in. Everything not explicitly
 * listed as staff is a student.
 */
function roleForEmail(email) {
  const e = email.toLowerCase();
  if (env.adminEmails.includes(e)) return 'admin';
  if (env.teacherEmails.includes(e)) return 'teacher';
  return 'student';
}

function assertDomainAllowed(email) {
  if (!env.allowedEmailDomain) return;
  const domain = email.split('@')[1] || '';
  if (domain.toLowerCase() !== env.allowedEmailDomain) {
    throw new ApiError(403, `Sign in with your @${env.allowedEmailDomain} college account`);
  }
}

async function upsertUser({ email, name, picture, googleId }) {
  const lower = email.toLowerCase();
  let user = await User.findOne({ email: lower });

  if (!user) {
    user = await User.create({
      email: lower,
      name: name || lower.split('@')[0],
      picture: picture || '',
      googleId,
      role: roleForEmail(lower),
      lastLoginAt: new Date(),
    });
  } else {
    // Never downgrade a role that an admin has since changed in the database.
    if (googleId && !user.googleId) user.googleId = googleId;
    if (name) user.name = name;
    if (picture) user.picture = picture;
    user.lastLoginAt = new Date();
    await user.save();
  }
  return user;
}

router.get('/config', (_req, res) => {
  res.json({
    googleClientId: env.googleClientId,
    googleEnabled: Boolean(env.googleClientId),
    devLoginEnabled: env.allowDevLogin && !env.isProd,
    allowedEmailDomain: env.allowedEmailDomain || null,
  });
});

/**
 * Exchanges a Google Identity Services ID token for our own session cookie.
 * The email is taken from Google's verified claim — never from the client.
 */
router.post(
  '/google',
  loginLimiter,
  asyncHandler(async (req, res) => {
    if (!googleClient) throw new ApiError(503, 'Google sign-in is not configured on this server');

    const { credential } = req.body || {};
    if (!credential) throw new ApiError(400, 'Missing Google credential');

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new ApiError(401, 'Could not verify that Google sign-in');
    }

    if (!payload?.email_verified) throw new ApiError(403, 'Your Google email is not verified');
    assertDomainAllowed(payload.email);

    const user = await upsertUser({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      googleId: payload.sub,
    });

    issueSession(res, user);
    res.json({ user: user.toPublic() });
  })
);

/**
 * DEV ONLY. Lets the platform be exercised end-to-end before Google OAuth
 * credentials exist. Disabled whenever NODE_ENV=production (see env.js, which
 * refuses to boot if this is left on).
 */
router.post(
  '/dev-login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    if (env.isProd || !env.allowDevLogin) throw new ApiError(404, 'Route not found');

    const { email, role } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'A valid email is required');

    const lower = email.toLowerCase();
    let user = await User.findOne({ email: lower });
    if (!user) {
      user = await User.create({
        email: lower,
        name: lower.split('@')[0],
        role: ['student', 'teacher', 'admin'].includes(role) ? role : roleForEmail(lower),
        lastLoginAt: new Date(),
      });
    } else {
      user.lastLoginAt = new Date();
      await user.save();
    }

    issueSession(res, user);
    res.json({ user: user.toPublic(), dev: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user.toPublic() });
  })
);

/**
 * The student supplies their own name (and roll number), so every report names
 * a person rather than an email address.
 */
router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, rollNumber, department } = z
      .object({
        name: z.string().trim().min(2, 'Enter your full name').max(80),
        rollNumber: z.string().trim().max(40).default(''),
        department: z.string().trim().max(60).optional(),
      })
      .parse(req.body);

    req.user.name = name;
    req.user.rollNumber = rollNumber;

    // Only an HOD has a department, and only until they have named it. Ignoring
    // it otherwise stops a teacher or student moving themselves between
    // departments through the profile form.
    if (req.user.role === 'admin' && !req.user.department && department) {
      req.user.department = department;
    }

    req.user.profileCompletedAt = new Date();
    await req.user.save();

    res.json({ user: req.user.toPublic() });
  })
);

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

export default router;
