import crypto from 'node:crypto';
import { Attempt } from '../models/Attempt.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * The access gate from §5. All three conditions must hold, and all three are
 * checked here on the server — the test link itself grants nothing
 * (non-negotiable #6).
 */

// A session that has not sent a heartbeat for this long is treated as a crashed
// tab rather than a second concurrent device, so the student can resume.
export const SESSION_STALE_MS = 45_000;

/**
 * A result has to be attributable to a person, not just a mailbox, so the
 * student confirms their own name before they can sit anything.
 */
export function assertProfileComplete(user) {
  if (!user.profileCompletedAt) {
    throw new ApiError(428, 'Add your full name before starting a test', {
      reason: 'profile_incomplete',
    });
  }
}

export function assertOnAllowlist(test, user) {
  if (!test.allows(user.email)) {
    throw new ApiError(403, 'Your account is not on the list of students for this test');
  }
}

export function assertWithinWindow(test, now = new Date()) {
  if (now < test.startAt) {
    throw new ApiError(403, `This test opens at ${test.startAt.toLocaleString()}`);
  }
  if (now > test.endAt) {
    throw new ApiError(403, 'This test has closed');
  }
}

export function assertPublished(test) {
  if (test.status !== 'published') {
    throw new ApiError(403, 'This test has not been published yet');
  }
}

/**
 * Enforces one active session per student per test. A different browser may
 * only take over once the previous one has stopped sending heartbeats.
 */
export function assertSingleSession(attempt, sessionId) {
  if (!attempt.sessionId || attempt.sessionId === sessionId) return;

  const idleMs = Date.now() - new Date(attempt.lastHeartbeatAt || 0).getTime();
  if (idleMs < SESSION_STALE_MS) {
    throw new ApiError(
      409,
      'This test is already open in another window. Close it, or wait a minute and try again.'
    );
  }
}

export const newSessionId = () => crypto.randomUUID();

/**
 * The personal deadline: whichever comes first — the student's own duration
 * (plus any teacher extension) or the test's hard close.
 */
export function computeEndsAt(test, startedAt) {
  const personal = new Date(
    startedAt.getTime() + (test.durationMinutes + (test.extensionMinutes || 0)) * 60_000
  );
  return personal < test.endAt ? personal : test.endAt;
}

/**
 * Chooses the question set for one student. When the test defines a pool
 * larger than questionsPerStudent, each student gets their own random subset,
 * so neighbours are not looking at the same problems.
 */
export function buildQuestionOrder(test) {
  let ids = test.questions.map((q) => q._id ?? q);

  const shouldSample = test.questionsPerStudent > 0 && test.questionsPerStudent < ids.length;
  if (shouldSample || test.randomizeOrder) {
    ids = [...ids];
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  return shouldSample ? ids.slice(0, test.questionsPerStudent) : ids;
}

/**
 * Loads the caller's attempt and refuses every action once it is over. Used by
 * every in-exam endpoint so a tampered client cannot keep working past the end.
 */
export async function loadActiveAttempt(testId, userId, { allowFinished = false } = {}) {
  const attempt = await Attempt.findOne({ test: testId, student: userId });
  if (!attempt) throw new ApiError(404, 'You have not started this test');

  if (!allowFinished) {
    if (attempt.status === 'terminated') {
      throw new ApiError(423, 'Your attempt was ended for exam-rule violations');
    }
    if (attempt.status !== 'in_progress') {
      throw new ApiError(409, 'You have already submitted this test');
    }
  }
  return attempt;
}
