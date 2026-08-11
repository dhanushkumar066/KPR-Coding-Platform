/**
 * Server-side violation counting (non-negotiable #5).
 *
 * The browser only *reports* that something happened. Every decision about
 * whether it counts as a strike, and whether the attempt ends, is made here.
 *
 * The fairness safeguards from §9 live in this file: a brief focus loss is
 * forgiven, near-simultaneous events from one physical action collapse into a
 * single strike, and blocked-but-harmless actions are logged without penalty.
 */

// Types that can cost a student a warning.
const COUNTING_TYPES = new Set([
  'tab_switch',
  'window_blur',
  'fullscreen_exit',
  'large_paste',
  'devtools_suspected',
  // Capturing the paper is as serious as leaving the window for it.
  'screenshot_key',
  'snip_tool',
  'screen_overlay',
  'view_source_attempt',
  // Focus was gone when polled but no blur event ever arrived — the signature
  // of a floating or always-on-top window. It costs a strike for the same
  // reason window_blur does: the student was working somewhere else.
  'focus_lost_silently',
]);

// Types recorded for the teacher's log but never penalised — the UI already
// blocks them, so logging is enough.
const LOG_ONLY_TYPES = new Set([
  'copy',
  'paste',
  'context_menu',
  'print_attempt',
  'save_page_attempt',
]);

// Not misconduct at all — recorded so the teacher can read the timeline.
// `second_screen` sits here deliberately: having a second monitor is not
// cheating, it is context a teacher may want when weighing everything else.
const INFO_TYPES = new Set(['fullscreen_restored', 'second_screen']);

// One Alt-Tab can fire blur + visibilitychange + fullscreenchange within a few
// milliseconds. Anything inside this window after a counted strike is treated
// as the same physical action.
const DEDUPE_MS = 1800;

// Grace applies to "the page went away" style events only — a paste is a paste
// however brief it was, and a screenshot keypress has no duration at all.
const GRACE_ELIGIBLE = new Set([
  'tab_switch',
  'window_blur',
  'fullscreen_exit',
  'screen_overlay',
  'focus_lost_silently',
]);

/**
 * @returns {{counted: boolean, reason: string, warnings: number, terminated: boolean, limit: number}}
 */
export function applyViolation(attempt, test, event, now = new Date()) {
  const type = event.type;
  const durationMs = Number(event.durationMs || 0);
  const graceMs = test.graceMs ?? 2500;
  const limit = test.warningLimit ?? 3;

  let counted = false;
  let reason = '';

  if (INFO_TYPES.has(type)) {
    reason = 'Recorded for the timeline';
  } else if (LOG_ONLY_TYPES.has(type)) {
    reason = 'Blocked action — logged, not penalised';
  } else if (!COUNTING_TYPES.has(type)) {
    reason = 'Unrecognised event — logged only';
  } else if (GRACE_ELIGIBLE.has(type) && durationMs > 0 && durationMs < graceMs) {
    // Very brief loss of focus: warn on screen, but do not spend a strike.
    reason = `Under the ${Math.round(graceMs / 1000)}s grace period — warned, not counted`;
  } else {
    const lastCounted = [...attempt.violations].reverse().find((v) => v.counted);
    const sinceLast = lastCounted ? now.getTime() - new Date(lastCounted.at).getTime() : Infinity;

    if (sinceLast < DEDUPE_MS) {
      reason = 'Part of the same action as the previous strike';
    } else {
      counted = true;
      reason = 'Counted as a violation';
    }
  }

  attempt.violations.push({ type, at: now, durationMs, counted, reason, meta: event.meta || {} });
  if (counted) attempt.warnings += 1;

  // "Exceeding" the limit ends it: with a limit of 3 the student sees warnings
  // 1, 2 and 3, and the fourth counted violation terminates the attempt.
  const terminated = attempt.warnings > limit;

  return { counted, reason, warnings: attempt.warnings, terminated, limit };
}
