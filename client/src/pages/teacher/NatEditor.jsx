/**
 * Answer editor for a Numerical Answer Type question.
 *
 * GATE publishes NAT answers as a range — "2.4 to 2.6" — rather than a single
 * figure, because a question involving division has no one right decimal
 * expansion and candidates round differently. An exact answer is simply a range
 * of zero width, so both are the same control.
 */
export default function NatEditor({ value, onChange, marks }) {
  const set = (patch) => onChange({ ...value, ...patch });

  const min = Number(value.answerMin) || 0;
  const max = Number(value.answerMax) || 0;
  const isRange = min !== max;

  return (
    <section className="card px-5 py-4">
      <h2 className="mb-1 text-sm font-bold">The answer</h2>
      <p className="hint mb-4">
        Students type a number. There is <strong>no negative marking</strong> on this type — GATE
        does not penalise it, because there is nothing to guess between.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`btn btn-sm ${isRange ? 'btn-ghost' : 'btn-primary'}`}
          onClick={() => set({ answerMax: value.answerMin })}
        >
          One exact answer
        </button>
        <button
          type="button"
          className={`btn btn-sm ${isRange ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => set({ answerMax: Number(value.answerMin) + 0.1 })}
        >
          A range of answers
        </button>
      </div>

      {isRange ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="nat-min">
              Accept from
            </label>
            <input
              id="nat-min"
              type="number"
              step="any"
              className="input mono w-36"
              value={value.answerMin}
              onChange={(e) => set({ answerMin: e.target.value })}
            />
          </div>
          <span className="pb-2 text-sm text-[var(--text-muted)]">to</span>
          <div>
            <label className="label" htmlFor="nat-max">
              Accept up to
            </label>
            <input
              id="nat-max"
              type="number"
              step="any"
              className="input mono w-36"
              value={value.answerMax}
              onChange={(e) => set({ answerMax: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="nat-exact">
            Correct answer
          </label>
          <input
            id="nat-exact"
            type="number"
            step="any"
            className="input mono w-48"
            value={value.answerMin}
            // Both ends move together, so an exact answer stays a zero-width
            // range rather than becoming a silently open one.
            onChange={(e) => set({ answerMin: e.target.value, answerMax: e.target.value })}
          />
        </div>
      )}

      <div className="mt-4">
        <label className="label" htmlFor="nat-unit">
          Unit <span className="font-normal text-[var(--text-faint)]">(optional)</span>
        </label>
        <input
          id="nat-unit"
          className="input w-36"
          placeholder="ms"
          maxLength={16}
          value={value.unit}
          onChange={(e) => set({ unit: e.target.value })}
        />
        <p className="hint">
          Shown beside the box so nobody answers in the wrong scale. Never compared — a student
          types only the number.
        </p>
      </div>

      <p
        className="mt-4 rounded-md px-3 py-2 text-xs"
        style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
      >
        {isRange ? (
          <>
            Anything from <strong>{min}</strong> to <strong>{max}</strong> earns the full {marks}{' '}
            marks. Use a range when the answer is a fraction students will round differently.
          </>
        ) : (
          <>
            Only <strong>{min}</strong> earns the {marks} marks. If the answer is not a whole
            number, use a range instead — otherwise a student who rounds correctly still loses.
          </>
        )}
      </p>
    </section>
  );
}
