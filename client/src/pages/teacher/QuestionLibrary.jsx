import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '../../components/ui.jsx';

/**
 * The library is split by what a teacher is actually sitting down to write.
 *
 * The columns that matter differ completely between them — "test cases" is
 * meaningless for an MCQ, and "negative marking" is meaningless for a coding
 * question — so each tab shows its own, rather than one table of mostly-blank
 * cells. GATE is a workspace rather than a filter: questions written there
 * carry GATE's marking conventions and a paper section.
 */
const TABS = [
  {
    key: 'all',
    label: 'All questions',
    query: {},
    blurb: 'Everything you have written, newest first.',
  },
  {
    key: 'coding',
    label: 'Coding',
    query: { kind: 'coding' },
    blurb: 'Students implement a function and it is graded against hidden test cases.',
    newTo: '/teacher/questions/new?kind=coding',
  },
  {
    key: 'mcq',
    label: 'MCQ',
    query: { kind: 'mcq', style: 'standard' },
    blurb: 'Single or multiple answer. No negative marking unless you add it.',
    newTo: '/teacher/questions/new?kind=mcq',
  },
  {
    key: 'gate',
    label: 'GATE',
    query: { style: 'gate' },
    blurb:
      "GATE's own conventions: MCQ loses a third of its marks, MSQ and NAT lose nothing, and every question sits in a paper section.",
    newTo: '/teacher/questions/new?style=gate',
  },
];

const KIND_LABEL = { coding: 'Coding', mcq: 'MCQ', nat: 'NAT' };

function KindBadge({ q }) {
  const label = q.kind === 'mcq' && q.multiSelect ? 'MSQ' : KIND_LABEL[q.kind] || q.kind;
  const tone = q.kind === 'coding' ? 'badge-muted' : q.kind === 'nat' ? 'badge-warn' : 'badge-ok';
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** What this question costs a student who gets it wrong, in plain words. */
function marking(q) {
  if (q.kind === 'nat') return 'No negative marking';
  if (q.kind !== 'mcq') return '—';
  if (q.multiSelect) return 'No negative marking';
  if (!q.penalty) return 'No negative marking';
  return `−${q.penalty} for a wrong answer`;
}

export default function QuestionLibrary() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tabKey = params.get('tab') || 'all';
  const tab = useMemo(() => TABS.find((t) => t.key === tabKey) || TABS[0], [tabKey]);

  const [state, setState] = useState({ loading: true, error: null, questions: [] });
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const qs = new URLSearchParams(tab.query);
      if (search) qs.set('search', search);
      if (difficulty) qs.set('difficulty', difficulty);
      const { questions } = await api.get(`/questions?${qs}`);
      setState({ loading: false, error: null, questions });
    } catch (error) {
      setState({ loading: false, error, questions: [] });
    }
  }, [search, difficulty, tab]);

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  const setTab = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };

  const duplicate = async (id) => {
    try {
      await api.post(`/questions/${id}/duplicate`);
      toast.success('Copied — edit the copy for this semester');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id, title) => {
    if (!window.confirm(`Delete "${title}"?`)) return;
    try {
      await api.del(`/questions/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const { questions } = state;
  const isGate = tab.key === 'gate';
  const showCases = tab.key === 'all' || tab.key === 'coding';
  const showMarking = tab.key === 'mcq' || isGate;

  // GATE papers are 100 marks: 15 of General Aptitude and 85 of the subject.
  // Shown as a running total so a teacher can see where a paper stands, never
  // enforced — a topic-wise practice set is a perfectly reasonable thing to build.
  const gateTotals = useMemo(() => {
    if (!isGate) return null;
    const total = questions.reduce((sum, q) => sum + (q.marks || 0), 0);
    const aptitude = questions
      .filter((q) => q.section === 'General Aptitude')
      .reduce((sum, q) => sum + (q.marks || 0), 0);
    return { total, aptitude, core: total - aptitude };
  }, [isGate, questions]);

  if (state.loading && !questions.length && !search && !difficulty) {
    return <PageLoader label="Loading your questions…" />;
  }
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Question library"
        subtitle="Write a question once, then reuse it across tests and semesters."
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Writing a whole paper is a different job from writing one
                question, and it is the one a GATE teacher is usually doing. */}
            {isGate && (
              <Link to="/teacher/gate" className="btn btn-primary">
                Build a paper
              </Link>
            )}
            <Link
              to={tab.newTo || '/teacher/questions/new'}
              className={`btn ${isGate ? 'btn-ghost' : 'btn-primary'}`}
            >
              {isGate ? 'Single question' : 'New question'}
            </Link>
          </div>
        }
      />

      {/* ------------------------------------------------------------- tabs */}
      <div className="mb-4 border-b">
        <div
          role="tablist"
          aria-label="Question type"
          className="-mb-px flex gap-1 overflow-x-auto"
        >
          {TABS.map((t) => {
            const active = t.key === tab.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className="relative shrink-0 px-3.5 py-2.5 text-sm font-semibold transition-colors"
                style={{
                  color: active ? 'var(--color-brand-600)' : 'var(--text-muted)',
                  borderBottom: `2px solid ${active ? 'var(--color-brand-600)' : 'transparent'}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mb-3 text-sm text-[var(--text-muted)]">{tab.blurb}</p>

      {gateTotals && questions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-4 rounded-md px-3.5 py-2.5 text-xs" style={{ background: 'var(--surface-2)' }}>
          <span>
            <span className="stat-label">Total</span>{' '}
            <b className="tabular-nums">{gateTotals.total}</b> marks
            {gateTotals.total !== 100 && (
              <span className="text-[var(--text-faint)]"> · a full GATE paper is 100</span>
            )}
          </span>
          <span>
            <span className="stat-label">General Aptitude</span>{' '}
            <b className="tabular-nums">{gateTotals.aptitude}</b>
            {gateTotals.aptitude !== 15 && (
              <span className="text-[var(--text-faint)]"> · GATE always allots 15</span>
            )}
          </span>
          <span>
            <span className="stat-label">Core subject</span>{' '}
            <b className="tabular-nums">{gateTotals.core}</b>
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="input w-auto max-w-72"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select w-auto"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
        >
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>

      {!questions.length ? (
        <EmptyState
          title={search || difficulty ? 'Nothing matches that' : `No ${tab.key === 'all' ? '' : tab.label} questions yet`}
          body={
            search || difficulty
              ? 'Try a different search, or clear the filters.'
              : tab.blurb
          }
          action={
            !search && !difficulty ? (
              <Link to={tab.newTo || '/teacher/questions/new'} className="btn btn-primary mt-2">
                Write your first one
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                <th className="px-4 py-2.5 font-semibold">Title</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                {isGate && <th className="px-4 py-2.5 font-semibold">Section</th>}
                <th className="px-4 py-2.5 font-semibold">Difficulty</th>
                <th className="px-4 py-2.5 font-semibold">Marks</th>
                {showMarking && <th className="px-4 py-2.5 font-semibold">If wrong</th>}
                {showCases && <th className="px-4 py-2.5 font-semibold">Test cases</th>}
                <th className="px-4 py-2.5 font-semibold">Updated</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {questions.map((q) => (
                <tr key={q.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3">
                    <Link
                      to={`/teacher/questions/${q.id}`}
                      className="font-medium hover:text-[var(--color-brand-600)]"
                    >
                      {q.title}
                    </Link>
                    {q.tags?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {q.tags.map((t) => (
                          <span key={t} className="badge badge-muted">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <KindBadge q={q} />
                      {/* Only worth flagging outside the GATE tab, where it is
                          true of every row and would just be noise. */}
                      {!isGate && q.style === 'gate' && <span className="badge badge-muted">GATE</span>}
                    </div>
                    {q.kind === 'mcq' && (
                      <div className="mt-1 text-xs text-[var(--text-faint)] tabular-nums">
                        {q.optionCount} options · {q.correctCount} correct
                      </div>
                    )}
                    {q.kind === 'nat' && q.natRange && (
                      <div className="mt-1 text-xs text-[var(--text-faint)] tabular-nums">
                        {q.natRange.min === q.natRange.max
                          ? q.natRange.min
                          : `${q.natRange.min} to ${q.natRange.max}`}
                        {q.natRange.unit ? ` ${q.natRange.unit}` : ''}
                      </div>
                    )}
                  </td>

                  {isGate && (
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {q.section || <span className="text-[var(--text-faint)]">—</span>}
                    </td>
                  )}

                  <td className="px-4 py-3">
                    <span
                      className={`badge badge-${q.difficulty === 'hard' ? 'bad' : q.difficulty === 'medium' ? 'warn' : 'ok'}`}
                    >
                      {q.difficulty}
                    </span>
                  </td>

                  <td className="px-4 py-3 tabular-nums">{q.marks}</td>

                  {showMarking && (
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{marking(q)}</td>
                  )}

                  {showCases && (
                    <td className="px-4 py-3 text-xs">
                      {q.kind === 'coding' ? (
                        <>
                          <span className="tabular-nums">{q.caseCount}</span> total ·{' '}
                          <span className="tabular-nums">{q.sampleCount}</span> visible
                          {q.caseCount === q.sampleCount && q.caseCount > 0 && (
                            <span className="badge badge-warn ml-1">no hidden cases</span>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--text-faint)]">—</span>
                      )}
                    </td>
                  )}

                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {formatDateTime(q.updatedAt)}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button className="btn btn-ghost btn-sm" onClick={() => duplicate(q.id)}>
                        Duplicate
                      </button>
                      <button
                        className="btn btn-ghost btn-sm text-[var(--bad)]"
                        onClick={() => remove(q.id, q.title)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
