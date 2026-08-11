export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatClock(ms) {
  if (ms == null || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const VIOLATION_LABELS = {
  tab_switch: 'Switched tab',
  window_blur: 'Left the exam window',
  fullscreen_exit: 'Exited fullscreen',
  large_paste: 'Pasted a large block of code',
  copy: 'Copy attempt',
  paste: 'Paste attempt',
  context_menu: 'Right-click',
  devtools_suspected: 'Developer tools suspected',
  screenshot_key: 'Pressed the screenshot key',
  snip_tool: 'Opened the screen-snip tool',
  // Named for what was actually observed, not for a product we cannot identify.
  screen_overlay: 'Screen covered by a system overlay (possible on-screen search)',
  print_attempt: 'Tried to print the page',
  save_page_attempt: 'Tried to save the page',
  view_source_attempt: 'Tried to view the page source',
  fullscreen_restored: 'Returned to fullscreen',
  fullscreen_deadline_missed: 'Did not return to fullscreen in time',
  // Focus was gone when polled but no blur event arrived — what a floating or
  // always-on-top window looks like from inside the page.
  focus_lost_silently: 'Focus moved to another window (possible floating window)',
  // Context, not misconduct.
  second_screen: 'Using more than one display',
};

export const violationLabel = (type) => VIOLATION_LABELS[type] || type;

/**
 * A score, as a person should read it.
 *
 * Marking arithmetic is deliberately exact all the way through — GATE deducts a
 * true third, and rounding each deduction before summing compounds into a wrong
 * total. That means a raw score can arrive as -0.6666666666666666, so every
 * place that shows one to a human formats it here: at most two decimals, and no
 * trailing zeros on a whole number.
 */
export function formatScore(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(n) ? String(n) : String(n);
}
