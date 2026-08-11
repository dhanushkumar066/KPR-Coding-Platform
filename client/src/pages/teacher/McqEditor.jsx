/**
 * Options editor for a multiple-choice question.
 *
 * The correct answers live only on the server — nothing here is ever sent to a
 * student's browser during an exam.
 */
export default function McqEditor({ value, onChange, marks }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const negativeFraction = Number(value.negativeFraction) || 0;

  const setOption = (i, patch) =>
    set({ options: value.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });

  const addOption = () =>
    set({ options: [...value.options, { text: '', isCorrect: false, explanation: '' }] });

  const removeOption = (i) => set({ options: value.options.filter((_, idx) => idx !== i) });

  /** Single-answer questions can only have one option ticked. */
  const chooseCorrect = (i, checked) => {
    if (value.multiSelect) return setOption(i, { isCorrect: checked });
    set({ options: value.options.map((o, idx) => ({ ...o, isCorrect: idx === i })) });
  };

  const correctCount = value.options.filter((o) => o.isCorrect).length;
  const filled = value.options.filter((o) => o.text.trim()).length;

  return (
    <div className="flex flex-col gap-4">
      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Answer options</h2>

        <div className="flex flex-col gap-2">
          {value.options.map((option, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg border px-3 py-2"
              style={{
                borderColor: option.isCorrect ? 'var(--ok)' : 'var(--border)',
                background: option.isCorrect ? 'var(--ok-bg)' : 'transparent',
              }}
            >
              <label className="mt-2 flex shrink-0 items-center gap-1.5 text-xs font-semibold">
                <input
                  type={value.multiSelect ? 'checkbox' : 'radio'}
                  name="mcq-correct"
                  checked={option.isCorrect}
                  onChange={(e) => chooseCorrect(i, e.target.checked)}
                />
                correct
              </label>

              <div className="flex-1">
                <input
                  className="input"
                  placeholder={`Option ${i + 1}`}
                  value={option.text}
                  onChange={(e) => setOption(i, { text: e.target.value })}
                />
                <input
                  className="input mt-1.5 text-xs"
                  placeholder="Why this is right or wrong (shown after the test)"
                  value={option.explanation}
                  onChange={(e) => setOption(i, { explanation: e.target.value })}
                />
              </div>

              <button
                type="button"
                className="mt-2 shrink-0 text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                onClick={() => removeOption(i)}
                disabled={value.options.length <= 2}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={addOption}>
          + Add option
        </button>

        {filled < 2 && (
          <p className="mt-2 text-xs" style={{ color: 'var(--bad)' }}>
            Add at least two options with text.
          </p>
        )}
        {filled >= 2 && correctCount === 0 && (
          <p className="mt-2 text-xs" style={{ color: 'var(--bad)' }}>
            Mark at least one option as correct.
          </p>
        )}
        {filled >= 2 && correctCount === filled && (
          <p className="mt-2 text-xs" style={{ color: 'var(--bad)' }}>
            Every option is correct — the question has no wrong answer.
          </p>
        )}
      </section>

      <section className="card px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Marking</h2>

          {/*
            GATE's own scheme, which students sitting a mock will expect:
              - single-answer  → a third of the marks off for a wrong answer
              - multiple-answer → no deduction at all, and no partial credit;
                the set must be exactly right
            Applying it is one click rather than three settings to remember.
          */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Single answer: −⅓. Multiple answers: no negative marking, no partial credit."
            onClick={() =>
              set(
                value.multiSelect
                  ? { negativeFraction: 0, negativeMarks: 0, partialCredit: false }
                  : { negativeFraction: 1 / 3, negativeMarks: 0 }
              )
            }
          >
            Use GATE marking
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.multiSelect}
              onChange={(e) => {
                const multiSelect = e.target.checked;
                // Going back to single-answer, keep only the first tick.
                const options = multiSelect
                  ? value.options
                  : value.options.map((o, idx) => ({
                      ...o,
                      isCorrect: idx === value.options.findIndex((x) => x.isCorrect),
                    }));
                set({ multiSelect, options });
              }}
            />
            <span>
              <span className="block font-medium">More than one answer can be correct</span>
              <span className="block text-xs text-[var(--text-muted)]">
                Students see checkboxes instead of radio buttons.
              </span>
            </span>
          </label>

          {value.multiSelect && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={value.partialCredit}
                onChange={(e) => set({ partialCredit: e.target.checked })}
              />
              <span>
                <span className="block font-medium">Give partial credit</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  Each correct tick earns a share of the {marks} marks; each wrong tick cancels one
                  out. Off means all-or-nothing.
                </span>
              </span>
            </label>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.shuffleOptions}
              onChange={(e) => set({ shuffleOptions: e.target.checked })}
            />
            <span>
              <span className="block font-medium">Shuffle the options per student</span>
              <span className="block text-xs text-[var(--text-muted)]">
                Neighbours see a different order, so &ldquo;the answer is B&rdquo; is useless. The
                order stays the same for a student across reloads.
              </span>
            </span>
          </label>

          <div className="border-t pt-3">
            <p className="label">Negative marking for a wrong answer</p>

            {/* A fraction stays proportionate across a paper mixing 1- and
                2-mark questions, which is why GATE expresses it that way. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: 'None', fraction: 0 },
                { label: '⅓ of the marks', fraction: 1 / 3 },
                { label: '¼', fraction: 0.25 },
                { label: '½', fraction: 0.5 },
                { label: 'Full marks', fraction: 1 },
              ].map((opt) => {
                const active =
                  Math.abs((Number(value.negativeFraction) || 0) - opt.fraction) < 0.005 &&
                  !(opt.fraction === 0 && Number(value.negativeMarks) > 0);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => set({ negativeFraction: opt.fraction, negativeMarks: 0 })}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <p className="hint mt-2">
              {negativeFraction > 0 ? (
                <>
                  A wrong answer costs{' '}
                  <strong>
                    {Math.round(marks * negativeFraction * 100) / 100} of the {marks} marks
                  </strong>
                  . Because it is a fraction, the same setting stays fair if you later change this
                  question&apos;s marks.
                </>
              ) : (
                'No deduction for a wrong answer.'
              )}
            </p>

            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
                Use a fixed number of marks instead
              </summary>
              <div className="mt-2">
                <input
                  id="mcq-neg"
                  type="number"
                  min={0}
                  max={marks || 100}
                  step={0.25}
                  className="input w-32"
                  value={value.negativeMarks}
                  onChange={(e) => set({ negativeMarks: e.target.value, negativeFraction: 0 })}
                />
                <p className="hint">
                  A flat deduction, ignored while a fraction is chosen above. Useful when a paper
                  states its penalty in whole marks.
                </p>
              </div>
            </details>

            <p className="hint mt-2">
              Leaving the question unanswered is <strong>never</strong> penalised — only a wrong
              answer is. The paper total is floored at zero however the individual questions land.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
