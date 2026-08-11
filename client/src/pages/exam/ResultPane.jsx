import { VerdictBadge, Spinner } from '../../components/ui.jsx';

/**
 * The console below the editor: per-case pass/fail and output.
 * Hidden cases show a verdict only — never their input or expected output.
 */
export default function ResultPane({ result, busy, busyLabel, samples, sampleCases }) {
  if (busy) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={busyLabel} />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-3)] text-[var(--text-faint)]">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 4.2 6 7.7l-3.5 3.5M8.4 11.8h5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-[var(--text-muted)]">No results yet</p>
        <p className="max-w-md text-xs text-[var(--text-faint)]">
          <span className="font-semibold">Run</span> checks the {samples ?? 0} sample case
          {samples === 1 ? '' : 's'} with no penalty. <span className="font-semibold">Submit</span>{' '}
          grades every case, including the hidden ones.
        </p>
      </div>
    );
  }

  const compileError = result.results.find((r) => r.compileOutput)?.compileOutput;

  // A run against the student's own input has nothing to be right or wrong
  // about — it only shows what the program printed.
  const isCustomRun = Boolean(result.customInput);

  return (
    <div className="animate-fade-in flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-[var(--surface)] px-4 py-2.5">
        <span className="eyebrow mr-1 hidden sm:inline">Console</span>
        <VerdictBadge verdict={isCustomRun && result.verdict === 'Accepted' ? 'Ran' : result.verdict} />
        {isCustomRun ? (
          <span className="text-xs text-[var(--text-muted)]">your own input — not graded</span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            {result.passedCount} of {result.totalCount} passed
          </span>
        )}
        {result.kind !== 'run' && !isCustomRun && (
          <span className="text-xs font-semibold">
            Score {result.score} / {result.maxScore}
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--text-faint)]">
          {result.maxTimeMs} ms
          {result.maxMemoryKb ? ` · ${Math.round(result.maxMemoryKb / 1024)} MB` : ''}
        </span>
      </div>

      {result.pasteSignals?.events > 0 && (
        <p
          className="border-b px-4 py-2 text-xs"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
        >
          <strong>This answer contains pasted code.</strong>{' '}
          {result.pasteSignals.events} paste
          {result.pasteSignals.events === 1 ? '' : 's'} totalling{' '}
          {result.pasteSignals.totalChars} characters was recorded and is shown to your teacher
          alongside this submission.
        </p>
      )}

      {result.error && (
        <p className="border-b px-4 py-2 text-xs" style={{ color: 'var(--bad)' }}>
          {result.error}
        </p>
      )}

      {/* The plain-English cause, above the compiler's own words. A message
          like "duplicate class: Main" is accurate and tells a student nothing
          about what they actually did. */}
      {result.hint && (
        <div
          className="flex items-start gap-2.5 border-b px-4 py-3 text-sm"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
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
            <path d="M8 7.2v4M8 4.8h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span>{result.hint}</span>
        </div>
      )}

      {compileError && (
        <div className="border-b px-4 py-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--bad)' }}>
            Compiler output
          </p>
          <pre className="io-block allow-select">{compileError}</pre>
        </div>
      )}

      <div className="flex flex-col divide-y">
        {result.results.map((r) => (
          <div key={r.index} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {!isCustomRun && (
                <span className={`badge badge-${r.passed ? 'ok' : 'bad'}`}>
                  {r.passed ? 'Passed' : 'Failed'}
                </span>
              )}
              <span className="text-xs font-medium">
                {isCustomRun
                  ? 'Your test'
                  : r.isSample
                    ? `Sample ${r.index + 1}`
                    : `Hidden case ${r.index + 1}`}
              </span>
              {!r.passed && <span className="text-xs text-[var(--text-muted)]">{r.verdict}</span>}
              <span className="ml-auto text-[0.7rem] text-[var(--text-faint)]">{r.timeMs} ms</span>
            </div>

            {/* Only sample cases ever reveal their I/O. Input and expected come
                from the question itself, matched by position — the server never
                echoes them back with the result. */}
            {(isCustomRun || r.isSample) && (r.stdout || r.stderr || !r.passed) && (
              <div className="mt-2 flex flex-col gap-2">
                {(isCustomRun ? result.customInput : sampleCases?.[r.index]?.input) !==
                  undefined && (
                  <div>
                    <p className="mb-1 text-[0.68rem] font-semibold uppercase text-[var(--text-faint)]">
                      Input
                    </p>
                    <pre className="io-block allow-select">
                      {isCustomRun ? result.customInput : sampleCases?.[r.index]?.input}
                    </pre>
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p
                      className="mb-1 text-[0.68rem] font-semibold uppercase"
                      style={{ color: r.passed ? 'var(--text-faint)' : 'var(--bad)' }}
                    >
                      Your output
                    </p>
                    <pre className="io-block allow-select">{r.stdout || '(empty)'}</pre>
                  </div>

                  {/* Shown only when it failed — seeing the answer next to a
                      pass is noise, and next to a fail is the whole point. */}
                  {!r.passed && !isCustomRun && sampleCases?.[r.index] && (
                    <div>
                      <p className="mb-1 text-[0.68rem] font-semibold uppercase text-[var(--text-faint)]">
                        Expected
                      </p>
                      <pre className="io-block allow-select">
                        {sampleCases[r.index].expectedOutput}
                      </pre>
                    </div>
                  )}
                </div>

                {r.stderr ? (
                  <div>
                    <p
                      className="mb-1 text-[0.68rem] font-semibold uppercase"
                      style={{ color: 'var(--bad)' }}
                    >
                      Error output
                    </p>
                    <pre className="io-block allow-select">{r.stderr}</pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
