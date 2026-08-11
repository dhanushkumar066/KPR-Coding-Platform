import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime, formatScore } from '../../lib/format.js';
import { EmptyState, ErrorState, PageHeader, PageLoader, Stat } from '../../components/ui.jsx';

/**
 * The head of department's view of every student, across every paper.
 *
 * A teacher's analytics answers "how did this paper go". This answers "how is
 * each student doing" — which is what a head is actually asked in a review
 * meeting, and which no amount of reading one paper at a time will tell them.
 */

const band = (pct) => {
  if (pct >= 75) return { label: 'strong', tone: 'var(--ok)' };
  if (pct >= 40) return { label: '', tone: undefined };
  return { label: 'struggling', tone: 'var(--bad)' };
};

export default function AdminAnalytics() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [sort, setSort] = useState('percentage');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.get('/admin/analytics');
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const students = state.data?.students || [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? students.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.email.toLowerCase().includes(q) ||
            (s.rollNumber || '').toLowerCase().includes(q)
        )
      : students;

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return (a.name || a.email).localeCompare(b.name || b.email);
      if (sort === 'roll') return (a.rollNumber || '').localeCompare(b.rollNumber || '');
      if (sort === 'taken') return b.testsTaken - a.testsTaken;
      if (sort === 'lowest') return a.percentage - b.percentage;
      return b.percentage - a.percentage;
    });
  }, [state.data, sort, search]);

  if (state.loading) return <PageLoader label="Gathering your department's results…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const { department, summary, tests } = state.data;

  if (!summary) {
    return (
      <>
        <PageHeader title={`${department} — results`} />
        <EmptyState
          title="No papers yet"
          body="Once your teachers have run a test, every student's marks across every paper appear here."
          action={
            <Link to="/admin/users" className="btn btn-primary mt-2">
              Add teaching staff
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${department} — results`}
        subtitle="Every student, across every paper this department has run."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Papers set" value={summary.tests} />
        <Stat label="Students" value={summary.students} />
        <Stat label="Papers sat" value={summary.papersSat} />
        <Stat label="Department average" value={`${summary.averagePercent}%`} />
        <Stat
          label="Below 40%"
          value={summary.below40}
          tone={summary.below40 ? 'bad' : undefined}
        />
      </div>

      {/* ------------------------------------------------------- per paper */}
      <section className="card mb-4 overflow-x-auto">
        <h2 className="border-b px-4 py-2.5 text-sm font-bold">Papers</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
              <th className="px-4 py-2.5 font-semibold">Title</th>
              <th className="px-4 py-2.5 font-semibold">Opened</th>
              <th className="px-4 py-2.5 font-semibold">Sat by</th>
              <th className="px-4 py-2.5 font-semibold">Average</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tests.map((t) => (
              <tr key={t.id} className="hover:bg-[var(--surface-2)]">
                <td className="px-4 py-2.5 font-medium">
                  <Link to={`/teacher/tests/${t.id}`} className="hover:text-[var(--color-brand-600)]">
                    {t.title}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">
                  {formatDateTime(t.startAt)}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{t.sat}</td>
                <td className="px-4 py-2.5 tabular-nums">
                  {t.sat ? `${t.averagePercent}%` : <span className="text-[var(--text-faint)]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ----------------------------------------------------- per student */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-72"
          placeholder="Search name, roll number or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="percentage">Best first</option>
          <option value="lowest">Needs attention first</option>
          <option value="name">By name</option>
          <option value="roll">By roll number</option>
          <option value="taken">Most papers sat</option>
        </select>
        <span className="text-xs text-[var(--text-faint)]">
          {rows.length} student{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
              <th className="px-4 py-2.5 font-semibold">Student</th>
              <th className="px-4 py-2.5 font-semibold">Roll no.</th>
              <th className="px-4 py-2.5 font-semibold">Papers sat</th>
              <th className="px-4 py-2.5 font-semibold">Marks</th>
              <th className="px-4 py-2.5 font-semibold">Overall</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((s) => {
              const b = band(s.percentage);
              return (
                <tr key={s.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3">
                    <span className="font-medium">{s.name || '—'}</span>
                    <span className="mono block text-xs text-[var(--text-faint)]">{s.email}</span>
                  </td>
                  <td className="px-4 py-3 mono text-xs">{s.rollNumber || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{s.testsTaken}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatScore(s.score)} / {s.maxScore}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full"
                        style={{ background: 'var(--surface-3)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, s.percentage)}%`,
                            background: b.tone || 'var(--color-brand-500)',
                          }}
                        />
                      </div>
                      <b className="tabular-nums" style={b.tone ? { color: b.tone } : undefined}>
                        {s.percentage}%
                      </b>
                      {b.label && (
                        <span className={`badge badge-${s.percentage < 40 ? 'bad' : 'ok'}`}>
                          {b.label}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Counts every paper set by this department's staff. A student who also sits another
        department's paper appears in that department's figures too — the paper belongs to whoever
        set it, which is why a shared first-year course is counted once, by the department that ran
        it.
      </p>
    </>
  );
}
