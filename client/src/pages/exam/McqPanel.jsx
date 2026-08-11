/**
 * The answer panel for a multiple-choice question.
 *
 * Selections auto-save like code drafts and are graded when the attempt
 * finishes. Nothing here reveals whether an answer is right: showing that
 * during the exam would let a student find the answer by trying each option.
 */
import { formatScore } from '../../lib/format.js';

export default function McqPanel({ question, selected, onChange, savedAt }) {
  const multi = question.mcq.multiSelect;
  const chosen = new Set(selected || []);
  // Already resolved to marks by the server, however it was configured. The
  // value is exact — a third of a mark is 0.3333… — so it is only ever shown
  // through formatScore. A student staring at "−0.6666666666666666 for a wrong
  // answer" mid-exam learns nothing except that something is broken.
  const penalty = question.mcq.penalty || 0;
  const penaltyText = formatScore(penalty);

  const toggle = (optionId) => {
    if (!multi) return onChange([optionId]);
    const next = new Set(chosen);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    onChange([...next]);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">Your answer</h2>
        <span className="badge badge-muted">
          {multi ? 'Select all that apply' : 'Select one'}
        </span>
        {multi && question.mcq.correctCount > 0 && (
          <span className="badge badge-muted">
            {question.mcq.correctCount} of {question.mcq.optionCount} are correct
          </span>
        )}
        {penalty > 0 && (
          <span className="badge badge-warn">−{penaltyText} for a wrong answer</span>
        )}
      </div>

      {/* The whole scheme in one line, the way an exam paper states it. A
          student weighing whether to guess should not have to reconstruct it
          from three separate badges under time pressure. */}
      {penalty > 0 && (
        <p
          className="mb-3 rounded-md px-3 py-2 text-xs"
          style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}
        >
          <strong>Marking:</strong> +{question.marks} if correct, −{penaltyText} if wrong,{' '}
          <strong>0 if you leave it blank</strong>. Leaving it alone never costs you anything.
          {multi && question.mcq.partialCredit
            ? ' Partly right answers earn part of the marks.'
            : multi
              ? ' You must select exactly the right set — there is no partial credit.'
              : ''}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {question.options.map((option, i) => {
          const isChosen = chosen.has(option.id);
          return (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors"
              style={{
                borderColor: isChosen ? 'var(--color-brand-500)' : 'var(--border)',
                background: isChosen ? 'var(--color-brand-50)' : 'var(--surface)',
              }}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`mcq-${question.id}`}
                className="mt-0.5"
                checked={isChosen}
                onChange={() => toggle(option.id)}
              />
              <span className="flex-1 allow-select">
                <span className="mr-2 font-semibold text-[var(--text-faint)]">
                  {String.fromCharCode(65 + i)}.
                </span>
                {option.text}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {chosen.size > 0 ? (
          <span className="badge badge-ok">Answer saved</span>
        ) : (
          <span className="badge badge-muted">Not answered yet</span>
        )}
        {/* Clearing lives in the exam-wide action row ("Clear response"), where
            GATE puts it and where it works for all three question kinds. A
            second button here would just be two names for one thing. */}
        {savedAt && (
          <span className="text-xs text-[var(--text-faint)]">
            Saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <p className="hint mt-3">
        There is nothing to submit for this question. Your selection is saved automatically and
        marked when you finish the test, so you can change it any time before then.
        {question.mcq.negativeMarks > 0 && (
          <>
            {' '}
            Leaving it unanswered scores 0 rather than a penalty, so only answer if you have a view.
          </>
        )}
      </p>
    </div>
  );
}
