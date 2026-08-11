import Markdown from '../../components/Markdown.jsx';

/**
 * The problem statement exactly as a student sees it.
 *
 * The teacher's question editor renders this same component for its preview
 * (with `preview`), so "what students see" cannot drift from what they see.
 */
export default function ProblemPane({ question, index, total, preview = false }) {
  if (!question) return null;

  const difficultyTone =
    question.difficulty === 'hard' ? 'bad' : question.difficulty === 'medium' ? 'warn' : 'ok';

  return (
    <div className={preview ? 'flex flex-col' : 'flex h-full flex-col overflow-y-auto'}>
      <div
        className={`border-b bg-[var(--surface)] px-5 py-3 ${preview ? '' : 'sticky top-0 z-10'}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {!preview && (
            <span className="text-xs font-semibold text-[var(--text-faint)]">
              Question {index + 1} of {total}
            </span>
          )}
          <span className={`badge badge-${difficultyTone}`}>{question.difficulty}</span>
          <span className="badge badge-muted">{question.marks} marks</span>
          {/* Three kinds, not two. Testing for "mcq or else" quietly treated a
              NAT question as code and showed it a time and memory limit it has
              no use for. */}
          {question.kind === 'mcq' ? (
            <span className="badge badge-info">
              {question.mcq?.multiSelect ? 'Multiple select' : 'Multiple choice'}
            </span>
          ) : question.kind === 'nat' ? (
            <span className="badge badge-info">Numerical answer</span>
          ) : (
            <>
              <span className="badge badge-muted">{question.timeLimitSec}s</span>
              <span className="badge badge-muted">{question.memoryLimitMb} MB</span>
            </>
          )}
        </div>
        <h1 className="mt-2 text-xl font-bold leading-tight tracking-tight">{question.title}</h1>
      </div>

      <div className="flex flex-col gap-5 px-5 py-4 text-sm">
        {question.ioMode === 'function' && question.functionSpec?.name && (
          <div
            className="rounded-lg px-3 py-2.5 text-xs"
            style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
          >
            Complete <code className="mono font-semibold">{question.functionSpec.name}</code> and{' '}
            <strong>return</strong> your answer. Do not read input or print anything — the arguments
            are already given to you, and your returned value is what gets checked.
          </div>
        )}

        <Markdown>{question.statement}</Markdown>

        {question.inputFormat && (
          <section>
            <h2 className="eyebrow mb-1.5">
              Input
            </h2>
            <Markdown className="text-sm">{question.inputFormat}</Markdown>
          </section>
        )}

        {question.outputFormat && (
          <section>
            <h2 className="eyebrow mb-1.5">
              Output
            </h2>
            <Markdown className="text-sm">{question.outputFormat}</Markdown>
          </section>
        )}

        {question.constraints && (
          <section>
            <h2 className="eyebrow mb-1.5">
              Constraints
            </h2>
            <Markdown className="text-sm">{question.constraints}</Markdown>
          </section>
        )}

        {/* Sample cases belong to code and nothing else.
            This used to read "mcq ? null : show them", which sent a NAT
            question down the coding branch and called .map() on samples it
            never has — crashing the whole exam page to a blank screen mid-
            attempt. Testing for the kind that actually has samples cannot fail
            that way when a fourth kind is added. */}
        {question.kind === 'coding' && (
        <section>
          <h2 className="eyebrow mb-2.5">
            Sample cases
          </h2>
          <div className="flex flex-col gap-3">
            {(question.samples || []).map((sample, i) => (
              <div key={sample.id} className="card overflow-hidden">
                <p className="border-b bg-[var(--surface-2)] px-3.5 py-2 text-xs font-bold">
                  Sample {i + 1}
                </p>
                <div className="flex flex-col gap-3 px-3.5 py-3">
                  <div>
                    <p className="eyebrow mb-1.5">Input</p>
                    {/* Labelled where we can — the shape every student has
                        already seen on LeetCode. */}
                    <pre className="io-block allow-select">
                      {sample.labelledInput || sample.input}
                    </pre>
                  </div>
                  <div>
                    <p className="eyebrow mb-1.5">Expected output</p>
                    <pre
                      className="io-block allow-select"
                      style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}
                    >
                      {sample.expectedOutput}
                    </pre>
                  </div>
                </div>
                {sample.explanation && (
                  <p className="border-t px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
                    {sample.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
          {question.hiddenCaseCount > 0 && (
            <p className="mt-2 text-xs text-[var(--text-faint)]">
              Submitting also runs {question.hiddenCaseCount} hidden test case
              {question.hiddenCaseCount === 1 ? '' : 's'} you cannot see.
            </p>
          )}
        </section>
        )}
      </div>
    </div>
  );
}

