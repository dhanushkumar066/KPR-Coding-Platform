import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { ErrorState, PageHeader, PageLoader } from '../../components/ui.jsx';
import SettingsTab from './tabs/SettingsTab.jsx';
import AllowlistTab from './tabs/AllowlistTab.jsx';
import ShareTab from './tabs/ShareTab.jsx';
import ProctorTab from './tabs/ProctorTab.jsx';
import SubmissionsTab from './tabs/SubmissionsTab.jsx';
import AnalyticsTab from './tabs/AnalyticsTab.jsx';

const TABS = [
  { path: '', label: 'Settings', end: true },
  { path: 'allowlist', label: 'Students' },
  { path: 'share', label: 'Share' },
  { path: 'proctor', label: 'Live proctor' },
  { path: 'submissions', label: 'Submissions' },
  { path: 'analytics', label: 'Analytics' },
];

export default function TestDetail() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState({
    loading: true,
    error: null,
    test: null,
    blocking: { malformed: [], failed: [] },
    unchecked: [],
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { test, blocking, unchecked } = await api.get(`/tests/${testId}`);
      setState({
        loading: false,
        error: null,
        test,
        blocking: blocking || { malformed: [], failed: [] },
        unchecked: unchecked || [],
      });
    } catch (error) {
      setState({
        loading: false,
        error,
        test: null,
        blocking: { malformed: [], failed: [] },
        unchecked: [],
      });
    }
  }, [testId]);

  useEffect(() => {
    load();
  }, [load]);

  const test = state.test;

  const setPublished = async (status) => {
    setBusy(true);
    try {
      await api.post(`/tests/${testId}/publish`, { status });
      toast.success(status === 'published' ? 'Test published' : 'Moved back to draft');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/tests/${testId}/pause`, { paused: !test.paused });
      toast.info(res.paused ? 'Test paused for everyone' : 'Test resumed — lost time was returned');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const extend = async () => {
    const raw = window.prompt('Extend everyone by how many minutes?', '10');
    if (!raw) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 1) return toast.error('Enter a positive number');

    setBusy(true);
    try {
      const res = await api.post(`/tests/${testId}/extend`, { minutes, alsoExtendWindow: true });
      toast.success(`Extended by ${minutes} min — ${res.updated} live attempt(s) updated`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${test.title}"? This cannot be undone.`)) return;
    try {
      await api.del(`/tests/${testId}`);
      toast.success('Test deleted');
      navigate('/teacher');
    } catch (err) {
      if (err.status === 409) {
        if (!window.confirm(`${err.message}\n\nDelete anyway, destroying all student results?`)) return;
        await api.del(`/tests/${testId}?force=1`).catch((e) => toast.error(e.message));
        navigate('/teacher');
      } else {
        toast.error(err.message);
      }
    }
  };

  if (state.loading) return <PageLoader label="Loading test…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const now = Date.now();
  const live =
    test.status === 'published' &&
    now >= new Date(test.startAt).getTime() &&
    now <= new Date(test.endAt).getTime();

  return (
    <>
      <PageHeader
        title={test.title}
        subtitle={`${formatDateTime(test.startAt)} → ${formatDateTime(test.endAt)} · ${test.durationMinutes} min per student`}
        back={{ to: '/teacher', label: 'Tests' }}
        actions={
          <>
            <span className={`badge badge-${test.status === 'published' ? (live ? 'ok' : 'info') : 'muted'}`}>
              {test.status === 'published' ? (live ? 'Live now' : 'Published') : 'Draft'}
            </span>
            {test.paused && <span className="badge badge-warn">Paused</span>}

            {live && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={togglePause} disabled={busy}>
                  {test.paused ? 'Resume' : 'Pause'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={extend} disabled={busy}>
                  Extend time
                </button>
              </>
            )}

            <a
              className="btn btn-ghost btn-sm"
              href={`/api/tests/${testId}/export`}
              target="_blank"
              rel="noreferrer"
            >
              Export to Excel
            </a>

            {test.status === 'draft' ? (
              <button className="btn btn-primary btn-sm" onClick={() => setPublished('published')} disabled={busy}>
                Publish
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setPublished('draft')} disabled={busy}>
                Unpublish
              </button>
            )}
            <button className="btn btn-danger btn-sm" onClick={remove}>
              Delete
            </button>
          </>
        }
      />

      {/* A draft is invisible to students, and a small badge is easy to miss —
          say so plainly, with the fix one click away. */}
      {test.status === 'draft' && (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
        >
          <span>
            <strong>This test is a draft, so no student can see it.</strong> Publish it when the
            questions and student list are ready.
          </span>
          <button
            className="btn btn-primary btn-sm ml-auto"
            onClick={() => setPublished('published')}
            disabled={busy}
          >
            Publish now
          </button>
        </div>
      )}

      {test.status === 'published' && now < new Date(test.startAt).getTime() && (
        <div
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
        >
          Published. Students can see this listed as <strong>upcoming</strong>, and will be able to
          start it at <strong>{formatDateTime(test.startAt)}</strong>.
        </div>
      )}

      {/* Publishing checks these, but a published test can still go bad:
          editing a test case discards that question's result without
          un-publishing anything. Left unsaid, the next person to find out is a
          student, mid-exam. */}
      {(state.blocking.malformed.length > 0 || state.blocking.failed.length > 0) && (
        <div
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}
        >
          <p className="font-bold">
            {test.status === 'published'
              ? 'This test is live and contains a broken question.'
              : 'This test contains a broken question.'}
          </p>
          {state.blocking.malformed.length > 0 && (
            <p className="mt-1">
              {state.blocking.malformed.map((t) => `"${t}"`).join(', ')} —{' '}
              <strong>the test data cannot be read by the judge</strong>, so every student hits an
              error.
            </p>
          )}
          {state.blocking.failed.length > 0 && (
            <p className="mt-1">
              {state.blocking.failed.map((t) => `"${t}"`).join(', ')} —{' '}
              <strong>a correct solution does not pass its own cases</strong>.
            </p>
          )}
          <p className="mt-1">
            {test.status === 'published'
              ? 'Students may be hitting this right now. Pause the test and fix it.'
              : 'Publishing is blocked until this is fixed.'}
          </p>
        </div>
      )}

      {/* Not proof of anything, so it gets a line rather than a klaxon. */}
      {state.unchecked.length > 0 &&
        !state.blocking.malformed.length &&
        !state.blocking.failed.length && (
          <p className="mb-4 text-xs text-[var(--text-faint)]">
            {state.unchecked.length} question{state.unchecked.length === 1 ? '' : 's'} in this test
            {state.unchecked.length === 1 ? ' has' : ' have'} never been run against{' '}
            {state.unchecked.length === 1 ? 'its' : 'their'} own test cases. Optional —{' '}
            <strong>Verify every question</strong> on the Settings tab confirms the expected outputs
            are right.
          </p>
        )}

      <nav className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/teacher/tests/${testId}${tab.path ? `/${tab.path}` : ''}`}
            end={tab.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-[var(--color-brand-600)] text-[var(--color-brand-600)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<SettingsTab test={test} onSaved={load} />} />
        <Route path="allowlist" element={<AllowlistTab test={test} onChanged={load} />} />
        <Route path="share" element={<ShareTab test={test} />} />
        <Route path="proctor" element={<ProctorTab test={test} />} />
        <Route path="submissions" element={<SubmissionsTab test={test} />} />
        <Route path="analytics" element={<AnalyticsTab test={test} />} />
        <Route path="*" element={<Navigate to={`/teacher/tests/${testId}`} replace />} />
      </Routes>
    </>
  );
}
