import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { formatDateTime, formatScore } from '../../../lib/format.js';
import { EmptyState, ErrorState, PageLoader, VerdictBadge } from '../../../components/ui.jsx';

export default function SubmissionsTab({ test }) {
  const [state, setState] = useState({ loading: true, error: null, submissions: [] });
  const [questionId, setQuestionId] = useState('');
  const [search, setSearch] = useState('');
  const [bestOnly, setBestOnly] = useState(true);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const qs = questionId ? `?questionId=${questionId}` : '';
      const { submissions } = await api.get(`/tests/${test._id}/submissions${qs}`);
      setState({ loading: false, error: null, submissions });
    } catch (error) {
      setState({ loading: false, error, submissions: [] });
    }
  }, [test._id, questionId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    let list = state.submissions;

    if (bestOnly) {
      // One row per student per question — the attempt that actually counted.
      const best = new Map();
      for (const s of list) {
        const key = `${s.student.id}|${s.question.id}`;
        const current = best.get(key);
        if (!current || s.score > current.score) best.set(key, s);
      }
      list = [...best.values()];
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.student.email?.toLowerCase().includes(q) || s.student.name?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [state.submissions, bestOnly, search]);

  if (state.loading) return <PageLoader label="Loading submissions…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select w-auto"
          value={questionId}
          onChange={(e) => setQuestionId(e.target.value)}
        >
          <option value="">All questions</option>
          {test.questions.map((q, i) => (
            <option key={q.id} value={q.id}>
              Q{i + 1} — {q.title}
            </option>
          ))}
        </select>

        <input
          className="input w-auto max-w-64"
          placeholder="Search student…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={bestOnly}
            onChange={(e) => setBestOnly(e.target.checked)}
          />
          Best submission only
        </label>

        <span className="ml-auto text-xs text-[var(--text-faint)]">{rows.length} shown</span>
      </div>

      {!rows.length ? (
        <EmptyState title="No submissions yet" body="Graded submissions appear here as students submit." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                <th className="px-4 py-2.5 font-semibold">Student</th>
                <th className="px-4 py-2.5 font-semibold">Question</th>
                <th className="px-4 py-2.5 font-semibold">Verdict</th>
                <th className="px-4 py-2.5 font-semibold">Cases</th>
                <th className="px-4 py-2.5 font-semibold">Score</th>
                <th className="px-4 py-2.5 font-semibold">Language</th>
                <th className="px-4 py-2.5 font-semibold">Submitted</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{s.student.name}</p>
                    <p className="mono text-[0.7rem] text-[var(--text-faint)]">{s.student.email}</p>
                  </td>
                  <td className="px-4 py-2.5">{s.question.title}</td>
                  <td className="px-4 py-2.5">
                    <VerdictBadge verdict={s.verdict} />
                    {s.kind === 'auto' && <span className="badge badge-warn ml-1">auto</span>}
                    {s.pasteSignals?.events > 0 && (
                      <span
                        className="badge badge-warn ml-1"
                        title={`${s.pasteSignals.events} paste(s), ${s.pasteSignals.totalChars} characters`}
                      >
                        pasted
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {s.passedCount}/{s.totalCount}
                  </td>
                  <td className="px-4 py-2.5 font-semibold tabular-nums">
                    {formatScore(s.score)} / {s.maxScore}
                    {s.overridden && <span className="badge badge-info ml-1">override</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{s.language}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                    {formatDateTime(s.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link to={`/teacher/submissions/${s.id}`} className="btn btn-ghost btn-sm">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
