import { formatClock, formatDateTime } from '../../lib/format.js';

/**
 * The screen shown before the exam chrome takes over. Stating the rules plainly
 * up front is part of the fairness contract — nobody should lose a warning to a
 * rule they were never told about.
 */
export default function ExamGate({ test, questionCount, remainingMs, warnings, onBegin, onCancel }) {
  const resuming = warnings > 0 || remainingMs < test.durationMinutes * 60_000 - 5000;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="animate-fade-up w-full max-w-3xl">
        {/* Centred masthead, matching the pre-flight design: the paper's
            identity and its three numbers before any rules. */}
        <div className="mb-6 text-center">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            {test.isPractice && <span className="badge badge-info">Practice</span>}
            {resuming && <span className="badge badge-warn">Already started</span>}
          </div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-[var(--color-brand-700)]">
            {test.title}
          </h1>
          {test.description && (
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-muted)]">
              {test.description}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-stretch justify-center divide-x divide-[var(--border)]">
            <div className="px-7">
              <p className="stat-label">Questions</p>
              <p className="mt-0.5 text-2xl font-bold">{questionCount}</p>
            </div>
            <div className="px-7">
              <p className="stat-label">Duration</p>
              <p className="mt-0.5 text-2xl font-bold">
                {test.durationMinutes}
                <span className="ml-1 text-sm font-medium text-[var(--text-faint)]">min</span>
              </p>
            </div>
            <div className="px-7">
              <p className="stat-label">Closes</p>
              <p className="mt-1.5 text-sm font-semibold">{formatDateTime(test.endAt)}</p>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b bg-[var(--surface-2)] px-6 py-4 text-center">
            <p className="stat-label">Time remaining</p>
            <p className="mono mt-1 text-3xl font-bold tabular-nums">{formatClock(remainingMs)}</p>
          </div>

          <div className="px-6 py-5">
            <h2 className="mb-1 text-base font-bold">Before you begin</h2>
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              Nobody should lose a warning to a rule they were never told about — so here they all
              are.
            </p>
            <ul className="ml-4 flex list-disc flex-col gap-1.5 text-sm text-[var(--text-muted)]">
              <li>
                The test runs in <strong>fullscreen</strong>. Leaving fullscreen, switching tabs, or
                clicking away from this window is recorded.
              </li>
              {test.fullscreenGraceSec > 0 && (
                <li>
                  If you leave fullscreen you get{' '}
                  <strong>{test.fullscreenGraceSec} seconds</strong> to return. A countdown covers
                  the questions until you do. Miss it and your attempt ends — your work is submitted
                  and graded, not discarded.
                </li>
              )}
              <li>
                Pasted code is recorded and shown to your teacher next to the answer you submit.
              </li>
              <li>
                You get <strong>{test.warningLimit} warnings</strong>. Exceeding them ends your
                attempt — your work is submitted and graded automatically, and your teacher reviews
                it.
              </li>
              <li>
                A very brief slip (under {Math.round((test.graceMs ?? 2500) / 1000)} seconds) warns
                you without costing a warning.
              </li>
              <li>Copy, paste and right-click are disabled. Large pastes into the editor are logged.</li>
              <li>
                Your code auto-saves every few seconds. If your browser crashes or your connection
                drops, sign back in and continue — that is not treated as cheating.
              </li>
              <li>
                <strong>Run</strong> tests only the visible samples and costs nothing.{' '}
                <strong>Submit</strong> grades every case, including hidden ones. You may submit as
                often as you like; your best submission counts.
              </li>
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t bg-[var(--surface-2)] px-6 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <svg
                width="19"
                height="19"
                viewBox="0 0 16 16"
                fill="none"
                className="mt-0.5 shrink-0 text-[var(--color-brand-600)]"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 7.2v4M8 4.8h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {resuming ? 'Your work is safe' : 'Everything is ready'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {resuming
                    ? 'Your saved code and remaining time are intact. Carry on where you left off.'
                    : 'Take a breath. Your code saves automatically as you go.'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button className="btn btn-ghost" onClick={onCancel}>
                Not now
              </button>
              <button className="btn btn-primary" onClick={onBegin}>
                {resuming ? 'Resume in fullscreen' : 'Begin test in fullscreen'}
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3 8h9.5M9 4.5 12.5 8 9 11.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
