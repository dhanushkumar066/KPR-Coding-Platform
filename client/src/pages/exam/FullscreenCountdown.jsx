import { useEffect, useState } from 'react';

/**
 * The blocking overlay shown while a student is out of fullscreen.
 *
 * It covers the paper deliberately — someone who has alt-tabbed away should not
 * be able to keep reading the questions while the clock runs. The countdown is
 * a display: the server independently decides when the deadline passed, so
 * closing this overlay in devtools gains nothing.
 */
export default function FullscreenCountdown({ lostAt, deadlineSec, onReturn }) {
  const [remainingMs, setRemainingMs] = useState(deadlineSec * 1000);

  useEffect(() => {
    if (!lostAt) return undefined;
    const tick = () =>
      setRemainingMs(Math.max(0, lostAt + deadlineSec * 1000 - Date.now()));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [lostAt, deadlineSec]);

  if (!lostAt) return null;

  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.max(0, Math.min(1, remainingMs / (deadlineSec * 1000)));
  const critical = seconds <= 5;

  // Circumference of the r=52 ring, so the dash offset can be driven directly
  // from the fraction of time left.
  const CIRCUMFERENCE = 2 * Math.PI * 52;
  const accent = critical ? 'var(--bad)' : 'var(--color-brand-600)';

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1000] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 12, 20, 0.94)', backdropFilter: 'blur(3px)' }}
      role="alertdialog"
      aria-live="assertive"
    >
      <div
        className="animate-scale-in card w-full max-w-md px-8 py-9 text-center"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        <div
          className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full"
          style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 9v4.5m0 3h.01M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h2 className="text-2xl font-bold tracking-tight">Return to fullscreen</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-muted)]">
          You have left the exam window. Return to fullscreen to carry on where you left off.
        </p>

        {/* The ring reads as "time draining" at a glance, which the bare number
            alone does not — but the number stays, because a ring cannot be read
            precisely. */}
        <div className="relative mx-auto my-7 h-32 w-32">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="var(--surface-3)"
              strokeWidth="9"
            />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={accent}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
              style={{ transition: 'stroke-dashoffset 100ms linear, stroke 200ms ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`mono text-4xl font-bold tabular-nums ${critical ? 'animate-urgent' : ''}`}
              style={{ color: critical ? 'var(--bad)' : 'var(--text)' }}
            >
              {seconds}
            </span>
            <span className="eyebrow mt-0.5">second{seconds === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div
          className="flex items-start gap-2.5 rounded-md px-3.5 py-3 text-left text-sm"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 16 16"
            fill="none"
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 4.8v3.6m0 2.3h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span>
            If the countdown reaches zero your attempt ends — but{' '}
            <strong>your work is submitted and graded</strong>, not discarded.
          </span>
        </div>

        {/* Browsers only grant fullscreen from a real click, so this button is
            the only way back — hence it being the loudest thing on screen. */}
        <button className="btn btn-primary mt-5 w-full py-3 text-base" onClick={onReturn} autoFocus>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Re-enter fullscreen
        </button>

        <p className="hint mt-3">
          This is recorded either way. Coming back quickly keeps it from costing you the attempt.
        </p>
      </div>
    </div>
  );
}
