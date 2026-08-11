import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime, formatScore } from '../../lib/format.js';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '../../components/ui.jsx';

const WINDOW_COPY = {
  upcoming: { label: 'Opens soon', tone: 'info' },
  open: { label: 'Open now', tone: 'ok' },
  closed: { label: 'Closed', tone: 'muted' },
};

const ATTEMPT_COPY = {
  in_progress: { label: 'In progress', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'ok' },
  auto_submitted: { label: 'Auto-submitted', tone: 'warn' },
  terminated: { label: 'Ended for violations', tone: 'bad' },
};

export default function StudentTests() {
  const [state, setState] = useState({ loading: true, error: null, tests: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { tests } = await api.get('/exam/tests');
      setState({ loading: false, error: null, tests });
    } catch (error) {
      setState({ loading: false, error, tests: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) return <PageLoader label="Loading your tests…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="My tests"
        subtitle="Tests your teachers have assigned to your college account."
      />

      {!state.tests.length ? (
        <EmptyState
          title="No tests assigned yet"
          body="When a teacher adds your email to a test, it will appear here. Nothing is unlocked by a link alone."
        />
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {state.tests.map((test) => {
            const windowInfo = WINDOW_COPY[test.window];
            const attemptInfo = test.attempt ? ATTEMPT_COPY[test.attempt.status] : null;
            const canEnter =
              test.window === 'open' && (!test.attempt || test.attempt.status === 'in_progress');
            const finished = test.attempt && test.attempt.status !== 'in_progress';
            const resuming = test.attempt?.status === 'in_progress';

            return (
              <div
                key={test.id}
                className={`card flex flex-col overflow-hidden ${canEnter ? 'card-interactive' : ''}`}
              >
                {/* A test already under way is the one thing on this page a
                    student needs to find instantly. */}
                {resuming && (
                  <div className="flex items-center gap-2 bg-[var(--color-brand-600)] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                    </span>
                    In progress
                  </div>
                )}

                <div className="flex-1 px-5 py-4">
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                    <span className={`badge badge-${windowInfo.tone}`}>{windowInfo.label}</span>
                    {test.isPractice && <span className="badge badge-info">Practice</span>}
                    {attemptInfo && !resuming && (
                      <span className={`badge badge-${attemptInfo.tone}`}>{attemptInfo.label}</span>
                    )}
                    {test.paused && <span className="badge badge-warn">Paused</span>}
                  </div>

                  <h2 className="text-[1.05rem] font-bold leading-snug tracking-tight">
                    {test.title}
                  </h2>
                  {test.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--text-muted)]">
                      {test.description}
                    </p>
                  )}

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3.5">
                    <div>
                      <dt className="stat-label">Questions</dt>
                      <dd className="stat-value">{test.questionCount}</dd>
                    </div>
                    <div>
                      <dt className="stat-label">Duration</dt>
                      <dd className="stat-value">
                        {test.durationMinutes}
                        <span className="ml-1 text-xs font-medium text-[var(--text-faint)]">
                          min
                        </span>
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="stat-label">
                        {test.window === 'upcoming' ? 'Opens' : 'Closes'}
                      </dt>
                      <dd className="text-sm font-semibold">
                        {formatDateTime(test.window === 'upcoming' ? test.startAt : test.endAt)}
                      </dd>
                    </div>
                  </dl>

                  {finished && test.attempt.maxScore > 0 && (
                    <div className="mt-3.5 border-t pt-3.5">
                      <dt className="stat-label">Score</dt>
                      <dd className="mt-0.5 flex items-baseline gap-2">
                        <span className="text-xl font-bold text-[var(--ok)]">
                          {formatScore(test.attempt.score)}
                        </span>
                        <span className="text-sm text-[var(--text-faint)]">
                          / {test.attempt.maxScore}
                        </span>
                      </dd>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full bg-[var(--ok)] transition-[width] duration-500"
                          style={{
                            width: `${Math.round((test.attempt.score / test.attempt.maxScore) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t bg-[var(--surface-2)] px-5 py-3.5">
                  {canEnter ? (
                    <Link
                      to={`/exam/${test.id}`}
                      className="btn btn-primary w-full"
                      aria-label={`${resuming ? 'Resume' : 'Start'} ${test.title}`}
                    >
                      {resuming ? 'Resume test' : 'Start test'}
                    </Link>
                  ) : finished ? (
                    <Link to="/results" className="btn btn-ghost w-full">
                      View result
                    </Link>
                  ) : (
                    <button className="btn btn-ghost w-full" disabled>
                      {test.window === 'upcoming' ? 'Not open yet' : 'Closed'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
