import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '../../components/ui.jsx';

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

  if (state.loading) return <PageLoader label="Loading your tests…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const now = Date.now();

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
              {state.tests.map((t) => {
                const live =
                  t.status === 'published' &&
                  now >= new Date(t.startAt).getTime() &&
                  now <= new Date(t.endAt).getTime();

                return (
                  <tr key={t.id} className="hover:bg-[var(--surface-2)]">
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
                      <span className="font-medium tabular-nums">{t.finished}</span> finished ·{' '}
                      <span className="tabular-nums">{t.started}</span> started
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
