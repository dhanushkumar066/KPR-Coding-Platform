import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatDateTime, formatScore } from '../../lib/format.js';
import Markdown from '../../components/Markdown.jsx';
import CodeEditor from '../../components/CodeEditor.jsx';
import {
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageLoader,
  Spinner,
  Stat,
  VerdictBadge,
} from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const STATUS_COPY = {
  submitted: { label: 'Submitted', tone: 'ok' },
  auto_submitted: { label: 'Time expired', tone: 'warn' },
  terminated: { label: 'Ended for violations', tone: 'bad' },
};

export default function StudentResults() {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, results: [] });
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [review, setReview] = useState({}); // submissionId -> {loading, content, error}
  const [codeModal, setCodeModal] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [{ results }, status] = await Promise.all([
        api.get('/exam/results'),
        api.get('/reviews/status').catch(() => ({ available: false })),
      ]);
      setAiAvailable(status.available);
      setState({ loading: false, error: null, results });
    } catch (error) {
      setState({ loading: false, error, results: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (attemptId) => {
    if (openId === attemptId) {
      setOpenId(null);
      return;
    }
    setOpenId(attemptId);
    setDetail(null);
    try {
      setDetail(await api.get(`/exam/results/${attemptId}`));
    } catch (err) {
      toast.error(err.message);
      setOpenId(null);
    }
  };

  const requestReview = async (submissionId) => {
    setReview((r) => ({ ...r, [submissionId]: { loading: true } }));
    try {
      const { review: result } = await api.post(`/reviews/submissions/${submissionId}`);
      setReview((r) => ({ ...r, [submissionId]: { content: result.content } }));
    } catch (err) {
      setReview((r) => ({ ...r, [submissionId]: { error: err.message } }));
    }
  };

  const viewCode = async (submissionId, title) => {
    try {
      const { submission } = await api.get(`/exam/submissions/${submissionId}`);
      setCodeModal({ title, ...submission });
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (state.loading) return <PageLoader label="Loading your results…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  return (
    <>
      <PageHeader title="My results" subtitle="Your graded attempts and where you can improve." />

      {!state.results.length ? (
        <EmptyState
          title="Nothing graded yet"
          body="Once you finish a test, your score and a breakdown of every question show up here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {state.results.map((r) => {
            const status = STATUS_COPY[r.status] || STATUS_COPY.submitted;
            const pct = r.maxScore ? Math.round((r.score / r.maxScore) * 100) : 0;
            const isOpen = openId === r.attemptId;

            return (
              <div key={r.attemptId} className="card overflow-hidden">
                <button
                  onClick={() => openDetail(r.attemptId)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge badge-${status.tone}`}>{status.label}</span>
                      {r.test?.isPractice && <span className="badge badge-info">Practice</span>}
                      {r.warnings > 0 && (
                        <span className="badge badge-warn">
                          {r.warnings} warning{r.warnings === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-semibold">{r.test?.title}</p>
                    <p className="text-xs text-[var(--text-faint)]">
                      Submitted {formatDateTime(r.submittedAt)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums">
                      {formatScore(r.score)}
                      <span className="text-sm text-[var(--text-faint)]"> / {r.maxScore}</span>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{pct}%</p>
                  </div>

                  <span className="text-[var(--text-faint)]">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className="border-t bg-[var(--surface-2)] px-4 py-4">
                    {r.terminatedReason && (
                      <p
                        className="mb-3 rounded-lg px-3 py-2 text-sm"
                        style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
                      >
                        {r.terminatedReason}. Your work was still graded — your teacher reviews the
                        violation log and makes the final decision.
                      </p>
                    )}

                    {!detail ? (
                      <Spinner label="Loading breakdown…" />
                    ) : (
                      <div className="flex flex-col gap-3">
                        {detail.questions.map((q, i) => (
                          <div key={q.id} className="card px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-[var(--text-faint)]">
                                Q{i + 1}
                              </span>
                              <span className="font-medium">{q.title}</span>
                              {q.best ? (
                                <VerdictBadge verdict={q.best.verdict} />
                              ) : (
                                <span className="badge badge-muted">Not attempted</span>
                              )}
                              <span className="ml-auto text-sm font-semibold tabular-nums">
                                {formatScore(q.best?.score ?? 0)} / {q.marks}
                              </span>
                            </div>

                            {q.mcqReview && (
                              <div className="mt-2 flex flex-col gap-1.5">
                                {q.mcqReview.map((o) => {
                                  const tone = o.isCorrect
                                    ? 'ok'
                                    : o.selected
                                      ? 'bad'
                                      : null;
                                  return (
                                    <div
                                      key={o.id}
                                      className="rounded-lg border px-3 py-2 text-sm"
                                      style={{
                                        borderColor: tone ? `var(--${tone})` : 'var(--border)',
                                        background: tone ? `var(--${tone}-bg)` : 'transparent',
                                      }}
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        {o.isCorrect && <span className="badge badge-ok">correct</span>}
                                        {o.selected && (
                                          <span className={`badge badge-${o.isCorrect ? 'ok' : 'bad'}`}>
                                            you chose this
                                          </span>
                                        )}
                                        <span>{o.text}</span>
                                      </div>
                                      {o.explanation && (
                                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                                          {o.explanation}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* The NAT answer key. Without it a student sees
                                they lost the marks and never learns what the
                                accepted answer was — the one thing reviewing a
                                paper is for. */}
                            {q.natReview && (
                              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                                {(() => {
                                  const r = q.natReview;
                                  const right =
                                    r.value !== null &&
                                    r.value >= r.accepted.min &&
                                    r.value <= r.accepted.max;
                                  const unit = r.unit ? ` ${r.unit}` : '';
                                  const key = r.exact
                                    ? `${r.accepted.min}${unit}`
                                    : `${r.accepted.min} to ${r.accepted.max}${unit}`;
                                  return (
                                    <>
                                      <span
                                        className="rounded-lg border px-3 py-2"
                                        style={{
                                          borderColor: `var(--${right ? 'ok' : 'bad'})`,
                                          background: `var(--${right ? 'ok' : 'bad'}-bg)`,
                                        }}
                                      >
                                        <span className="stat-label">You answered</span>{' '}
                                        <b>{r.given.trim() || '— left blank'}</b>
                                      </span>
                                      <span
                                        className="rounded-lg border px-3 py-2"
                                        style={{
                                          borderColor: 'var(--ok)',
                                          background: 'var(--ok-bg)',
                                        }}
                                      >
                                        <span className="stat-label">Accepted</span> <b>{key}</b>
                                      </span>
                                    </>
                                  );
                                })()}
                              </div>
                            )}

                            {/* Test cases, a language and "view my code" only
                                mean anything for code. A NAT question has none
                                of them, and "not mcq" wrongly included it. */}
                            {q.best && q.kind === 'coding' && (
                              <>
                                <p className="mt-1 text-xs text-[var(--text-muted)]">
                                  {q.best.passedCount} of {q.best.totalCount} test cases passed ·{' '}
                                  {q.best.language} · {q.best.maxTimeMs} ms
                                </p>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => viewCode(q.best.id, q.title)}
                                  >
                                    View my code
                                  </button>
                                  {aiAvailable && (
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => requestReview(q.best.id)}
                                      disabled={review[q.best.id]?.loading}
                                    >
                                      {review[q.best.id]?.loading ? (
                                        <Spinner label="Writing review…" />
                                      ) : (
                                        'Explain where I went wrong'
                                      )}
                                    </button>
                                  )}
                                </div>

                                {review[q.best.id]?.error && (
                                  <p className="mt-2 text-xs" style={{ color: 'var(--bad)' }}>
                                    {review[q.best.id].error}
                                  </p>
                                )}

                                {review[q.best.id]?.content && (
                                  <div
                                    className="mt-3 rounded-lg border-l-2 px-3 py-3 text-sm"
                                    style={{
                                      background: 'var(--surface-2)',
                                      borderColor: 'var(--color-brand-500)',
                                    }}
                                  >
                                    <p className="mb-2 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                                      AI review — feedback only, it does not affect your marks
                                    </p>
                                    <Markdown>{review[q.best.id].content}</Markdown>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}

                        <div className="grid gap-2 sm:grid-cols-3">
                          <Stat label="Total" value={`${formatScore(r.score)} / ${r.maxScore}`} />
                          <Stat label="Percentage" value={`${pct}%`} />
                          <Stat label="Warnings" value={r.warnings} tone={r.warnings ? 'warn' : undefined} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(codeModal)}
        title={codeModal ? `Your submission — ${codeModal.title}` : ''}
        onClose={() => setCodeModal(null)}
        width="max-w-3xl"
      >
        {codeModal && (
          <div className="h-[55vh] overflow-hidden rounded-lg border">
            <CodeEditor value={codeModal.code} language={codeModal.language} readOnly />
          </div>
        )}
      </Modal>
    </>
  );
}
