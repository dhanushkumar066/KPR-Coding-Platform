import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { formatDateTime, formatDuration, formatScore } from '../../../lib/format.js';
import { EmptyState, ErrorState, PageLoader, Stat } from '../../../components/ui.jsx';

export default function AnalyticsTab({ test }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/tests/${test._id}/analytics`);
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, [test._id]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) return <PageLoader label="Crunching the numbers…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const { summary, questions, distribution, students = [] } = state.data;

  if (!summary.graded) {
    return (
      <EmptyState
        title="Nothing to analyse yet"
        body="Once students finish, you'll see pass rates per question, the class score distribution, and the most common failure points."
      />
    );
  }

  const maxBand = Math.max(...distribution.map((b) => b.count), 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Graded" value={summary.graded} />
        <Stat label="Mean" value={`${summary.meanPercent}%`} />
        <Stat label="Median" value={`${summary.medianPercent}%`} />
        <Stat label="Highest" value={`${summary.highestPercent}%`} tone="ok" />
        <Stat
          label="Terminated"
          value={summary.terminated}
          tone={summary.terminated ? 'bad' : undefined}
        />
      </div>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Class score distribution</h2>
        <div className="flex h-44 items-end gap-1.5">
          {distribution.map((band) => (
            <div key={band.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[0.65rem] tabular-nums text-[var(--text-faint)]">
                {band.count || ''}
              </span>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${(band.count / maxBand) * 100}%`,
                  minHeight: band.count ? '4px' : '2px',
                  background: band.count ? 'var(--color-brand-500)' : 'var(--surface-3)',
                }}
                title={`${band.label}: ${band.count} student(s)`}
              />
              <span className="text-[0.6rem] text-[var(--text-faint)]">
                {band.label.split('–')[0]}
              </span>
            </div>
          ))}
        </div>
        <p className="hint text-center">Percentage of total marks</p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <h2 className="text-sm font-bold">Per student</h2>
          <span className="badge badge-muted">{students.length} finished</span>
          <a
            className="btn btn-ghost btn-sm ml-auto"
            href={`/api/tests/${test._id}/export`}
            target="_blank"
            rel="noreferrer"
          >
            Export to Excel
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                <th className="px-4 py-2.5 font-semibold">Student</th>
                <th className="px-4 py-2.5 font-semibold">Score</th>
                <th className="px-4 py-2.5 font-semibold">Started</th>
                <th className="px-4 py-2.5 font-semibold">Completed</th>
                <th className="px-4 py-2.5 font-semibold">Took</th>
                <th className="px-4 py-2.5 font-semibold">Submissions</th>
                <th className="px-4 py-2.5 font-semibold">Errored</th>
                <th className="px-4 py-2.5 font-semibold">Runs</th>
                <th className="px-4 py-2.5 font-semibold">Warnings</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.map((s) => (
                <tr key={s.attemptId} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{s.name || s.email}</p>
                    <p className="mono text-[0.7rem] text-[var(--text-faint)]">
                      {s.rollNumber ? `${s.rollNumber} · ` : ''}
                      {s.email}
                    </p>
                    {s.status === 'terminated' && (
                      <span className="badge badge-bad mt-1">terminated</span>
                    )}
                    {s.status === 'auto_submitted' && (
                      <span className="badge badge-warn mt-1">time expired</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold tabular-nums">
                      {formatScore(s.score)} / {s.maxScore}
                    </span>
                    <p className="text-[0.7rem] text-[var(--text-muted)]">{s.percent}%</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{formatDateTime(s.startedAt)}</td>
                  <td className="px-4 py-2.5 text-xs">{formatDateTime(s.finishedAt)}</td>
                  <td className="px-4 py-2.5 text-xs tabular-nums">
                    {s.timeTakenMs == null ? '—' : formatDuration(s.timeTakenMs)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{s.submissions}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    <span style={{ color: s.erroredSubmissions ? 'var(--bad)' : undefined }}>
                      {s.erroredSubmissions}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-[var(--text-muted)]">{s.runs}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    <span style={{ color: s.warnings ? 'var(--warn)' : undefined }}>
                      {s.warnings}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-5 py-2 text-xs text-[var(--text-faint)]">
          <strong>Errored</strong> counts submissions that failed to compile, crashed, or the judge
          could not run — not wrong answers.
        </p>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b px-5 py-3 text-sm font-bold">Per question</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                <th className="px-4 py-2.5 font-semibold">Question</th>
                <th className="px-4 py-2.5 font-semibold">Attempted</th>
                <th className="px-4 py-2.5 font-semibold">Solved</th>
                <th className="px-4 py-2.5 font-semibold">Pass rate</th>
                <th className="px-4 py-2.5 font-semibold">Avg score</th>
                <th className="px-4 py-2.5 font-semibold">Most common outcomes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {questions.map((q, i) => (
                <tr key={q.questionId} className="align-top hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      <span className="text-[var(--text-faint)]">Q{i + 1}</span> {q.title}
                    </p>
                    <span className="badge badge-muted mt-1">{q.difficulty}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{q.attempted}</td>
                  <td className="px-4 py-3 tabular-nums">{q.solved}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 w-16 overflow-hidden rounded-full"
                        style={{ background: 'var(--surface-3)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${q.passRate}%`,
                            background:
                              q.passRate >= 60 ? 'var(--ok)' : q.passRate >= 30 ? 'var(--warn)' : 'var(--bad)',
                          }}
                        />
                      </div>
                      <span className="tabular-nums">{q.passRate}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {q.averageScore} / {q.marks}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {q.verdicts.slice(0, 4).map((v) => (
                        <span key={v.verdict} className="badge badge-muted">
                          {v.verdict} ×{v.count}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
