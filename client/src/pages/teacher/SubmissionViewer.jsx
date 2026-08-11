import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime, violationLabel, formatScore } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import CodeEditor from '../../components/CodeEditor.jsx';
import { ErrorState, PageHeader, PageLoader, Spinner, Stat, VerdictBadge } from '../../components/ui.jsx';

export default function SubmissionViewer() {
  const { submissionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [override, setOverride] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/tests/submissions/${submissionId}`);
      setState({ loading: false, error: null, data });
      setOverride(
        typeof data.submission.manualOverride?.score === 'number'
          ? String(data.submission.manualOverride.score)
          : ''
      );
      setNote(data.submission.manualOverride?.note || '');
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, [submissionId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveOverride = async (clear = false) => {
    setBusy(true);
    try {
      await api.post(`/tests/submissions/${submissionId}/override`, {
        score: clear ? null : Number(override),
        note: clear ? '' : note,
      });
      toast.success(clear ? 'Override removed — the machine score applies again' : 'Score overridden');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const regrade = async () => {
    setBusy(true);
    try {
      const { submission } = await api.post(`/tests/submissions/${submissionId}/regrade`);
      toast.success(`Re-graded: ${submission.verdict}`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) return <PageLoader label="Loading submission…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const { submission: s, attempt } = state.data;
  const overridden = typeof s.manualOverride?.score === 'number';
  const countedViolations = attempt?.violations?.filter((v) => v.counted).length ?? 0;

  return (
    <>
      <PageHeader
        title={s.student?.name || s.student?.email}
        subtitle={[
          s.student?.rollNumber,
          s.student?.email,
          s.question?.title,
          s.language,
          `submitted ${formatDateTime(s.createdAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        back={{ to: '#', label: 'Back' }}
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
              Back to list
            </button>
            {s.status === 'error' && (
              <button className="btn btn-primary btn-sm" onClick={regrade} disabled={busy}>
                Re-run grading
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat
              label="Score"
              value={`${s.effectiveScore} / ${s.maxScore}`}
              tone={overridden ? 'info' : undefined}
            />
            <Stat label="Cases passed" value={`${s.passedCount} / ${s.totalCount}`} />
            <Stat label="Peak time" value={`${s.maxTimeMs} ms`} />
            <Stat
              label="Warnings"
              value={attempt?.warnings ?? 0}
              tone={attempt?.warnings ? 'warn' : undefined}
            />
          </div>

          {s.kind === 'auto' && (
            <p
              className="rounded-lg px-4 py-2.5 text-sm"
              style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
            >
              This was auto-submitted when the attempt ended
              {attempt?.status === 'terminated' ? ' for exam-rule violations' : ' on time expiry'}.
              It was graded normally, not zeroed — the final decision is yours.
            </p>
          )}

          {s.pasteSignals?.events > 0 && (
            <div
              className="rounded-lg px-4 py-2.5 text-sm"
              style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
            >
              <strong>This answer was pasted in, at least in part.</strong>{' '}
              {s.pasteSignals.events} paste{s.pasteSignals.events === 1 ? '' : 's'} into this
              question&apos;s editor since their previous submission — {s.pasteSignals.totalChars}{' '}
              characters in total, the largest {s.pasteSignals.largestChars}.
              <span className="mt-1 block text-xs opacity-80">
                Pasting is not proof of misconduct on its own — a student may be moving their own
                code between questions. Read it next to the violation log and the code itself.
              </span>
            </div>
          )}

          {s.error && (
            <p
              className="rounded-lg px-4 py-2.5 text-sm"
              style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
            >
              Grading failed: {s.error}
            </p>
          )}

          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <h2 className="text-sm font-bold">Their code</h2>
              <VerdictBadge verdict={s.verdict} className="ml-auto" />
            </div>
            <div className="h-[420px]">
              <CodeEditor value={s.code} language={s.language} readOnly minimap />
            </div>
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b px-4 py-2.5 text-sm font-bold">
              Test cases — you see everything, including the hidden ones
            </h2>
            <div className="divide-y">
              {s.results.map((r) => (
                <div key={r.index} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge badge-${r.passed ? 'ok' : 'bad'}`}>
                      {r.passed ? 'Passed' : 'Failed'}
                    </span>
                    <span className="text-xs font-medium">
                      {r.isSample ? `Sample ${r.index + 1}` : `Hidden case ${r.index + 1}`}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{r.verdict}</span>
                    <span className="ml-auto text-[0.7rem] text-[var(--text-faint)]">
                      {r.earned.toFixed(2)} pts · {r.timeMs} ms
                    </span>
                  </div>

                  {!r.passed && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[0.68rem] font-semibold uppercase text-[var(--text-faint)]">
                          Their output
                        </p>
                        <pre className="io-block">{r.stdout || '(empty)'}</pre>
                      </div>
                      {(r.stderr || r.compileOutput) && (
                        <div>
                          <p
                            className="mb-1 text-[0.68rem] font-semibold uppercase"
                            style={{ color: 'var(--bad)' }}
                          >
                            {r.compileOutput ? 'Compiler' : 'Error output'}
                          </p>
                          <pre className="io-block">{r.compileOutput || r.stderr}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="card px-5 py-4">
            <h2 className="mb-1 text-sm font-bold">Manual score override</h2>
            <p className="hint mb-3">
              Replaces the machine score for this question. Use it when the automatic grade does not
              reflect what the student actually did.
            </p>

            <div className="flex flex-col gap-2">
              <div>
                <label className="label" htmlFor="ov-score">
                  Score (max {s.maxScore})
                </label>
                <input
                  id="ov-score"
                  type="number"
                  min={0}
                  max={s.maxScore}
                  step={0.5}
                  className="input"
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  placeholder={String(s.score)}
                />
              </div>
              <div>
                <label className="label" htmlFor="ov-note">
                  Note (for your records)
                </label>
                <input
                  id="ov-note"
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Correct approach, off-by-one on the last case"
                />
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary btn-sm flex-1"
                  onClick={() => saveOverride(false)}
                  disabled={busy || override === ''}
                >
                  {busy ? <Spinner label="Saving…" /> : 'Apply override'}
                </button>
                {overridden && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => saveOverride(true)}
                    disabled={busy}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {overridden && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Machine score was {formatScore(s.score)}. Overridden by{' '}
                {s.manualOverride.by?.name || s.manualOverride.by?.email || 'you'} on{' '}
                {formatDateTime(s.manualOverride.at)}.
              </p>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <h2 className="text-sm font-bold">Violation log</h2>
              <span className="badge badge-muted ml-auto">
                {countedViolations} counted / {attempt?.violations?.length ?? 0} events
              </span>
            </div>

            {attempt?.terminatedReason && (
              <p
                className="border-b px-4 py-2 text-xs"
                style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
              >
                {attempt.terminatedReason}
              </p>
            )}

            {!attempt?.violations?.length ? (
              <p className="px-4 py-4 text-sm text-[var(--text-muted)]">
                No events recorded — this attempt was clean.
              </p>
            ) : (
              <ul className="max-h-96 divide-y overflow-y-auto">
                {[...attempt.violations].reverse().map((v, i) => (
                  <li key={i} className="px-4 py-2">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: v.counted ? 'var(--bad)' : 'var(--border-strong)' }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{violationLabel(v.type)}</p>
                        <p className="text-[0.68rem] text-[var(--text-faint)]">
                          {v.counted ? 'Counted' : 'Not counted'}
                          {v.reason ? ` — ${v.reason}` : ''}
                          {v.durationMs ? ` · away ${(v.durationMs / 1000).toFixed(1)}s` : ''}
                          {v.meta?.length ? ` · ${v.meta.length} chars` : ''}
                        </p>
                      </div>
                      <span className="mono shrink-0 text-[0.65rem] text-[var(--text-faint)]">
                        {new Date(v.at).toLocaleTimeString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
