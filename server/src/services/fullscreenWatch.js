/**
 * The fullscreen re-entry deadline.
 *
 * The browser reports when fullscreen was lost and regained; the *deadline* is
 * evaluated here from the timestamp stored on the attempt (non-negotiable #5).
 * A student who tampers with the countdown in the page still gets terminated by
 * the server on the next heartbeat.
 */

/** Records that the student has left fullscreen, if not already recorded. */
export function noteFullscreenExit(attempt, now = new Date()) {
  if (!attempt.fullscreenExitAt) attempt.fullscreenExitAt = now;
}

/** Records that they are back, clearing the deadline. */
export function noteFullscreenRestored(attempt) {
  attempt.fullscreenExitAt = null;
  attempt.fullscreenEverEntered = true;
}

/**
 * @returns {{expired: boolean, msOut: number, deadlineMs: number, remainingMs: number}}
 */
export function checkFullscreenDeadline(attempt, test, now = new Date()) {
  const deadlineMs = (test.fullscreenGraceSec ?? 0) * 1000;
  const inactive = { expired: false, msOut: 0, deadlineMs, remainingMs: deadlineMs };

  // Disabled for this test.
  if (!deadlineMs) return inactive;
  // Currently in fullscreen.
  if (!attempt.fullscreenExitAt) return inactive;
  // Never got fullscreen in the first place — do not punish a browser refusal.
  if (!attempt.fullscreenEverEntered) return inactive;

  const msOut = now.getTime() - new Date(attempt.fullscreenExitAt).getTime();
  return {
    expired: msOut > deadlineMs,
    msOut,
    deadlineMs,
    remainingMs: Math.max(0, deadlineMs - msOut),
  };
}
