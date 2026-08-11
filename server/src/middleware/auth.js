import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export const SESSION_COOKIE = 'cca_session';

export function issueSession(res, user) {
  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    env.jwtSecret,
    { expiresIn: `${env.sessionTtlHours}h` }
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: env.sessionTtlHours * 3600 * 1000,
    path: '/',
  });
  return token;
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * Populates req.user from the session cookie. The role is re-read from the
 * database rather than trusted from the token, so a demotion takes effect
 * immediately instead of at token expiry.
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new ApiError(401, 'Not signed in');

    const payload = verifySessionToken(token);
    if (!payload) throw new ApiError(401, 'Session expired — sign in again');

    const user = await User.findById(payload.sub);
    if (!user) throw new ApiError(401, 'Account no longer exists');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** RBAC gate. `requireRole('teacher', 'admin')` — admin is never implicit. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not signed in'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}
