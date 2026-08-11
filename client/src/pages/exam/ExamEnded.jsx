const COPY = {
  submitted: {
    title: 'Test submitted',
    tone: 'ok',
    body: 'Your answers have been graded. You can review them and get an AI explanation of anything you got wrong.',
  },
  auto_submitted: {
    title: 'Time is up',
    tone: 'warn',
    body: 'Your time ran out, so everything you had written was submitted and graded automatically. Nothing was lost.',
  },
  terminated: {
    title: 'Your attempt was ended',
    tone: 'bad',
    body: 'You went past the warning limit for this test. Your work was still submitted and graded — it was not zeroed. Your teacher will review the violation log alongside your answers and makes the final decision.',
  },
};

export default function ExamEnded({ info, onExit }) {
  const copy = COPY[info?.status] || COPY.submitted;
  const scored = typeof info?.score === 'number';

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-lg overflow-hidden">
        <div
          className="px-6 py-5"
          style={{
            background: `var(--${copy.tone}-bg)`,
            color: `var(--${copy.tone})`,
          }}
        >
          <h1 className="text-lg font-bold">{copy.title}</h1>
          {info?.message && <p className="mt-1 text-sm opacity-90">{info.message}</p>}
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-[var(--text-muted)]">{copy.body}</p>

          {scored && (
            <div className="mt-4 rounded-xl border px-4 py-3 text-center">
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                Your score
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {info.score} <span className="text-base text-[var(--text-faint)]">/ {info.maxScore}</span>
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t bg-[var(--surface-2)] px-6 py-4">
          <button className="btn btn-primary" onClick={onExit}>
            View my results
          </button>
        </div>
      </div>
    </div>
  );
}
