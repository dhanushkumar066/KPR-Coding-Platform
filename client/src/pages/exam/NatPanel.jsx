/**
 * The answer panel for a Numerical Answer Type question — GATE's third type.
 *
 * The student types a number. Nothing here says whether it is right: revealing
 * that during the exam would turn the question into a guessing game, so it is
 * graded when the attempt finishes, like MCQ.
 */
export default function NatPanel({ question, value, onChange, savedAt }) {
  const unit = question.nat?.unit || '';

  /**
   * Only the characters a number is made of.
   *
   * GATE gives candidates a virtual keypad that cannot produce anything else;
   * this is the same idea on a real keyboard. Filtering as they type stops a
   * stray letter being discovered as an unanswered question after the exam.
   */
  const clean = (raw) => raw.replace(/[^0-9.eE+-]/g, '').slice(0, 32);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">Your answer</h2>
        <span className="badge badge-muted">Type a number</span>
        <span className="badge badge-ok">No negative marking</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          className="input mono max-w-xs text-lg"
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 2.5"
          aria-label="Numerical answer"
          value={value ?? ''}
          onChange={(e) => onChange(clean(e.target.value))}
        />
        {unit && <span className="text-sm font-semibold text-[var(--text-muted)]">{unit}</span>}
      </div>

      <p
        className="mt-3 rounded-md px-3 py-2 text-xs"
        style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
      >
        <strong>Marking:</strong> +{question.marks} if correct, <strong>0 if wrong</strong> — a
        wrong number never costs you marks, so there is no reason to leave this blank. Give a
        decimal if the answer is not a whole number.
      </p>

      {savedAt && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
          Saved {new Date(savedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
