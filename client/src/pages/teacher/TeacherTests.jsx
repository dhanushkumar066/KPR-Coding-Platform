import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { EmptyState, ErrorState, PageHeader, PageLoader, Stat } from '../../components/ui.jsx';

export default function TeacherTests() {
  const [state, setState] = useState({ loading: true, error: null, tests: [] });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { tests } = await api.get('/tests');
      setState({ loading: false, error: null, tests });
    } catch (error) {
      setState({ loading: false, error, tests: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const anyLive = state.tests.some(
      (t) =>
        t.status === 'published' &&
        Date.now() >= new Date(t.startAt).getTime() &&
        Date.now() <= new Date(t.endAt).getTime()
    );
    if (!anyLive) return undefined;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [state.tests, load]);

  const now = Date.now();
  const isLive = (t) =>
    t.status === 'published' &&
    now >= new Date(t.startAt).getTime() &&
    now <= new Date(t.endAt).getTime();

  /*
   * Running papers first.
   *
   * The list was newest-first, which is the right default right up until the
   * moment it matters least: during exam week a teacher opening this page has
   * exactly one question, and it is "how is the paper that is running right now
   * going". Anything they have to scroll for is the wrong thing at the top.
   *
   * Declared above the early returns below — a hook that runs only once the
   * data has loaded changes the hook count between renders, which React
   * rejects outright.
   */
  const ordered = useMemo(() => {
    const rank = (t) => (isLive(t) ? 0 : t.status === 'published' ? 1 : 2);
    return [...state.tests].sort(
      (a, b) => rank(a) - rank(b) || new Date(b.startAt) - new Date(a.startAt)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tests, now]);

  if (state.loading) return <PageLoader label="Loading your tests…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const liveTests = ordered.filter(isLive);
  const sitting = liveTests.reduce((sum, t) => sum + (t.started - t.finished), 0);

  return (
    <>
      <PageHeader
        title="Tests"
        subtitle="Create, schedule and monitor your coding tests."
        actions={
          <>
            <Link to="/teacher/questions" className="btn btn-ghost">
              Question library
            </Link>
            <Link to="/teacher/tests/new" className="btn btn-primary">
              New test
            </Link>
          </>
        }
      />

      {state.tests.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Live now"
            value={liveTests.length}
            tone={liveTests.length ? 'ok' : undefined}
          />
          <Stat label="Sitting right now" value={sitting} tone={sitting ? 'ok' : undefined} />
          <Stat
            label="Published"
            value={state.tests.filter((t) => t.status === 'published').length}
          />
          <Stat label="Drafts" value={state.tests.filter((t) => t.status === 'draft').length} />
        </div>
      )}

      {!state.tests.length ? (
        <EmptyState
          title="No tests yet"
          body="Create a question in your library first, then build a test around it."
          action={
            <Link to="/teacher/tests/new" className="btn btn-primary mt-2">
              Create your first test
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-shell min-w-[900px]">
            <thead>
              <tr>
                <th>Test</th>
                <th>Status</th>
                <th>Window</th>
                <th>Questions</th>
                <th>Students</th>
                <th>Progress</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ordered.map((t) => {
                const live = isLive(t);
                const pct = t.started ? Math.round((t.finished / t.started) * 100) : 0;

                return (
                  <tr
                    key={t.id}
                    className="hover:bg-[var(--surface-2)]"
                    style={live ? { background: 'var(--ok-bg)' } : undefined}
                  >
                    <td>
                      <Link
                        to={`/teacher/tests/${t.id}`}
                        className="font-medium hover:text-[var(--color-brand-600)]"
                      >
                        {t.title}
                      </Link>
                      {t.isPractice && <span className="badge badge-info ml-2">Practice</span>}
                    </td>
                    <td>
                      <span
                        className={`badge badge-${t.status === 'published' ? (live ? 'ok' : 'info') : 'muted'}`}
                      >
                        {t.status === 'published' ? (live ? 'Live now' : 'Published') : 'Draft'}
                      </span>
                      {t.paused && <span className="badge badge-warn ml-1">Paused</span>}
                    </td>
                    <td className="text-xs text-[var(--text-muted)]">
                      {formatDateTime(t.startAt)}
                      <br />→ {formatDateTime(t.endAt)}
                    </td>
                    <td className="tabular-nums">{t.questionCount}</td>
                    <td className="tabular-nums">{t.allowlistCount}</td>
                    <td className="text-xs">
                      {t.started ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full"
                            style={{ background: 'var(--surface-3)' }}
                          >
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: 'var(--ok)' }}
                            />
                          </div>
                          <span className="tabular-nums">
                            {t.finished}/{t.started}
                          </span>
                          {live && t.started > t.finished && (
                            <span className="badge badge-ok">
                              {t.started - t.finished} sitting
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-faint)]">nobody yet</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Link to={`/teacher/tests/${t.id}`} className="btn btn-ghost btn-sm">
                        {live ? 'Proctor' : 'Open'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
