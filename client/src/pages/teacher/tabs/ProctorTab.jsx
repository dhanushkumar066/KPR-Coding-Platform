import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { getSocket } from '../../../lib/socket.js';
import { formatClock, violationLabel, formatScore } from '../../../lib/format.js';
import { ErrorState, Modal, PageLoader, Spinner, Stat } from '../../../components/ui.jsx';
import { useToast } from '../../../context/ToastContext.jsx';

const STATUS_TONE = {
  in_progress: 'info',
  submitted: 'ok',
  auto_submitted: 'warn',
  terminated: 'bad',
};

const POLL_MS = 15_000;
const MAX_FEED = 80;

export default function ProctorTab({ test }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [feed, setFeed] = useState([]);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reinstating, setReinstating] = useState(null);
  const [extraMinutes, setExtraMinutes] = useState(15);
  const [resetWarnings, setResetWarnings] = useState(true);
  const [reinstateNote, setReinstateNote] = useState('');
  const [busy, setBusy] = useState(false);
  const feedRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/tests/${test._id}/proctor`);
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, [test._id]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Local ticker so the per-student countdowns move between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live feed over the websocket.
  useEffect(() => {
    const socket = getSocket();
    const testId = test._id;

    const push = (kind, payload) =>
      setFeed((prev) => [{ id: Math.random(), kind, at: new Date(), ...payload }, ...prev].slice(0, MAX_FEED));

    const onConnect = () => {
      setConnected(true);
      socket.emit('proctor:join', testId, (ack) => {
        if (!ack?.ok) setConnected(false);
      });
    };
    const onDisconnect = () => setConnected(false);

    const handlers = {
      'attempt:started': (p) => push('started', p),
      'attempt:violation': (p) => push('violation', p),
      'attempt:terminated': (p) => push('terminated', p),
      'attempt:reinstated': (p) => push('reinstated', p),
      'test:question-added': (p) => push('question-added', p),
      'attempt:submission': (p) => push('submission', p),
      'attempt:finished': (p) => push('finished', p),
      'test:paused': (p) => push('paused', p),
      'test:extended': (p) => push('extended', p),
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    if (socket.connected) onConnect();

    return () => {
      socket.emit('proctor:leave', testId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
    };
  }, [test._id]);

  // A violation or submission changes the table, so refresh it too (debounced).
  useEffect(() => {
    if (!feed.length) return undefined;
    const id = setTimeout(load, 1200);
    return () => clearTimeout(id);
  }, [feed.length, load]);

  const reinstate = async () => {
    setBusy(true);
    try {
      const res = await api.post(
        `/tests/${test._id}/attempts/${reinstating.attemptId}/reinstate`,
        { extraMinutes: Number(extraMinutes), resetWarnings, note: reinstateNote }
      );
      toast.success(res.message);
      setReinstating(null);
      setReinstateNote('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) return <PageLoader label="Loading the proctor view…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const { rows, summary, notStarted } = state.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Allowed" value={summary.allowed} />
        <Stat label="Connected" value={summary.connected} tone={summary.connected ? 'ok' : undefined} />
        <Stat label="In progress" value={summary.active} />
        <Stat label="Submitted" value={summary.submitted} tone="ok" />
        <Stat label="Terminated" value={summary.terminated} tone={summary.terminated ? 'bad' : undefined} />
        <Stat label="Not started" value={summary.notStarted} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-bold">Students</h2>
            <span className="text-xs text-[var(--text-faint)]">refreshes automatically</span>
            <button className="btn btn-ghost btn-sm ml-auto" onClick={load}>
              Refresh now
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
                  <th className="px-4 py-2 font-semibold">Student</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Time left</th>
                  <th className="px-4 py-2 font-semibold">Warnings</th>
                  <th className="px-4 py-2 font-semibold">Score</th>
                  <th className="px-4 py-2 font-semibold">Recent activity</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.attemptId} className="align-top hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          title={r.connected ? 'Connected' : 'Not connected'}
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: r.connected ? 'var(--ok)' : 'var(--border-strong)',
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {r.student.name || r.student.email}
                          </p>
                          <p className="mono truncate text-[0.7rem] text-[var(--text-faint)]">
                            {r.student.rollNumber ? `${r.student.rollNumber} · ` : ''}
                            {r.student.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`badge badge-${STATUS_TONE[r.status] || 'muted'}`}>
                        {r.status.replace(/_/g, ' ')}
                      </span>
                      {r.terminatedReason && (
                        <p className="mt-1 text-[0.7rem] text-[var(--text-muted)]">
                          {r.terminatedReason}
                        </p>
                      )}
                    </td>
                    <td className="mono px-4 py-2.5 tabular-nums">
                      {r.status === 'in_progress'
                        ? formatClock(new Date(r.endsAt).getTime() - now)
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="font-semibold tabular-nums"
                        style={{ color: r.warnings > 0 ? 'var(--warn)' : undefined }}
                      >
                        {r.warnings}
                      </span>
                      <span className="text-xs text-[var(--text-faint)]">
                        {' '}
                        / {test.warningLimit}
                      </span>
                      {r.totalViolations > r.countedViolations && (
                        <p className="text-[0.7rem] text-[var(--text-faint)]">
                          {r.totalViolations - r.countedViolations} forgiven
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {r.score == null ? '—' : `${formatScore(r.score)} / ${r.maxScore}`}
                    </td>
                    <td className="px-4 py-2.5">
                      {!r.recentViolations.length ? (
                        <span className="text-xs text-[var(--text-faint)]">Clean</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {r.recentViolations.slice(0, 3).map((v, i) => (
                            <li key={i} className="text-[0.7rem]">
                              <span style={{ color: v.counted ? 'var(--bad)' : 'var(--text-faint)' }}>
                                {v.counted ? '●' : '○'}
                              </span>{' '}
                              {violationLabel(v.type)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status !== 'in_progress' && (
                        <button
                          className="btn btn-ghost btn-sm whitespace-nowrap"
                          onClick={() => setReinstating(r)}
                        >
                          Let back in
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                      Nobody has opened this test yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {notStarted.length > 0 && (
            <div className="border-t px-4 py-3">
              <p className="mb-1 text-xs font-semibold text-[var(--text-faint)]">
                Not started ({notStarted.length})
              </p>
              <p className="mono text-[0.7rem] text-[var(--text-muted)]">
                {notStarted.slice(0, 25).join(', ')}
                {notStarted.length > 25 ? ` +${notStarted.length - 25} more` : ''}
              </p>
            </div>
          )}
        </section>

        <section className="card flex max-h-[70vh] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-bold">Live feed</h2>
            <span
              className={`badge badge-${connected ? 'ok' : 'muted'}`}
              title={connected ? 'Receiving events in real time' : 'Reconnecting…'}
            >
              {connected ? 'Live' : 'Offline'}
            </span>
            {feed.length > 0 && (
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setFeed([])}>
                Clear
              </button>
            )}
          </div>

          <div ref={feedRef} className="flex-1 divide-y overflow-y-auto">
            {!feed.length ? (
              <div className="flex h-full items-center justify-center px-4 py-8 text-center">
                {connected ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    Waiting for activity. Violations, submissions and sign-ins appear here the
                    instant they happen.
                  </p>
                ) : (
                  <Spinner label="Connecting…" />
                )}
              </div>
            ) : (
              feed.map((item) => <FeedRow key={item.id} item={item} />)
            )}
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(reinstating)}
        title="Let this student back in"
        onClose={() => setReinstating(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setReinstating(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={reinstate} disabled={busy}>
              {busy ? <Spinner label="Reopening…" /> : 'Reopen the attempt'}
            </button>
          </>
        }
      >
        {reinstating && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <strong>{reinstating.student.name || reinstating.student.email}</strong>&apos;s attempt
              ended
              {reinstating.terminatedReason ? ` — ${reinstating.terminatedReason}` : ''}. Reopening
              lets them carry on from their saved code. Everything they already submitted still
              counts, and the best score per question wins.
            </p>

            <div>
              <label className="label" htmlFor="ri-min">
                Give them how many more minutes?
              </label>
              <input
                id="ri-min"
                type="number"
                min={1}
                max={240}
                className="input"
                value={extraMinutes}
                onChange={(e) => setExtraMinutes(e.target.value)}
              />
              <p className="hint">
                Their new deadline cannot go past the test&apos;s closing time — extend the test
                window first if it is close.
              </p>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={resetWarnings}
                onChange={(e) => setResetWarnings(e.target.checked)}
              />
              Reset their warning count to zero
            </label>
            <p className="hint -mt-2">
              Leave this on if the termination looked like a false alarm; turn it off to send them
              back with their warnings intact.
            </p>

            <div>
              <label className="label" htmlFor="ri-note">
                Reason (recorded on the attempt)
              </label>
              <input
                id="ri-note"
                className="input"
                placeholder="Wi-Fi dropped, verified in person"
                value={reinstateNote}
                onChange={(e) => setReinstateNote(e.target.value)}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FeedRow({ item }) {
  const time = new Date(item.at).toLocaleTimeString();

  const render = () => {
    switch (item.kind) {
      case 'started':
        return { tone: 'info', text: `${item.student?.email} started the test` };
      case 'violation':
        return {
          tone: item.counted ? 'bad' : 'muted',
          text: `${item.studentEmail} — ${violationLabel(item.type)}`,
          sub: item.counted
            ? `Warning ${item.warnings} of ${item.limit}`
            : item.reason || 'Not counted',
        };
      case 'terminated':
        return {
          tone: 'bad',
          text: `${item.studentEmail} — attempt ended for violations`,
          sub: 'Their work was auto-submitted and graded',
        };
      case 'submission':
        return {
          tone: item.verdict === 'Accepted' ? 'ok' : 'warn',
          text: `${item.studentEmail} submitted`,
          sub: `${item.verdict} · ${formatScore(item.score)}/${item.maxScore}`,
        };
      case 'finished':
        return { tone: 'ok', text: `An attempt finished (${item.status.replace(/_/g, ' ')})` };
      case 'reinstated':
        return {
          tone: 'info',
          text: `${item.studentEmail} was let back in`,
          sub: `+${item.extraMinutes} minutes`,
        };
      case 'question-added':
        return {
          tone: 'info',
          text: `Question added: ${item.title}`,
          sub: item.reachedLiveStudents
            ? `Handed to ${item.reachedLiveStudents} student(s) mid-test`
            : 'Applies to students who start from now',
        };
      case 'paused':
        return { tone: 'warn', text: item.paused ? 'Test paused' : 'Test resumed' };
      case 'extended':
        return { tone: 'info', text: `Everyone extended by ${item.minutes} min` };
      default:
        return { tone: 'muted', text: item.kind };
    }
  };

  const { tone, text, sub } = render();

  return (
    <div className="px-4 py-2">
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: `var(--${tone === 'muted' ? 'text-faint' : tone})` }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug">{text}</p>
          {sub && <p className="text-[0.68rem] text-[var(--text-faint)]">{sub}</p>}
        </div>
        <span className="mono shrink-0 text-[0.65rem] text-[var(--text-faint)]">{time}</span>
      </div>
    </div>
  );
}
