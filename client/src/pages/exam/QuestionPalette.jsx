/**
 * GATE's question palette.
 *
 * Five states, each with its own shape as well as its own colour — GATE uses
 * shape to carry the meaning too, which is what makes the palette readable to
 * a colour-blind candidate and legible at a glance to everyone else.
 *
 * The state that trips people up every year is the fifth: a question that is
 * both answered and marked for review **is still evaluated**. Students believe
 * marking forfeits the answer and un-mark everything in the last five minutes.
 * The legend says so explicitly rather than leaving them to guess.
 */

export const PALETTE_STATES = {
  notVisited: {
    label: 'Not visited',
    help: 'You have not opened this question yet.',
    bg: 'var(--surface-3)',
    fg: 'var(--text-muted)',
    border: 'var(--border-strong)',
    // A plain square.
    radius: '4px',
  },
  notAnswered: {
    label: 'Not answered',
    help: 'You opened it but left it blank.',
    bg: '#c0392b',
    fg: '#fff',
    border: '#a5301f',
    // GATE draws this one with a flat top and pointed base.
    radius: '4px 4px 12px 12px',
  },
  answered: {
    label: 'Answered',
    help: 'Your answer is saved and will be marked.',
    bg: '#1e8449',
    fg: '#fff',
    border: '#166437',
    radius: '12px 12px 4px 4px',
  },
  marked: {
    label: 'Marked for review',
    help: 'Bookmarked to come back to. Left blank, it scores nothing.',
    bg: '#6c3fa8',
    fg: '#fff',
    border: '#54308a',
    radius: '999px',
  },
  answeredMarked: {
    label: 'Answered & marked',
    help: 'Answered AND bookmarked. This is still evaluated — marking never costs you the answer.',
    bg: '#6c3fa8',
    fg: '#fff',
    border: '#54308a',
    radius: '999px',
    tick: true,
  },
};

/** Which of the five states a question is in. */
export function paletteState({ visited, answered, marked }) {
  if (answered && marked) return 'answeredMarked';
  if (marked) return 'marked';
  if (answered) return 'answered';
  if (visited) return 'notAnswered';
  return 'notVisited';
}

function Swatch({ state, children, size = 34, onClick, title, active }) {
  const s = PALETTE_STATES[state];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="relative grid shrink-0 place-items-center text-xs font-bold transition-transform hover:scale-105"
      style={{
        width: size,
        height: size,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        borderRadius: s.radius,
        outline: active ? '2px solid var(--text)' : 'none',
        outlineOffset: '2px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {children}
      {s.tick && (
        // The green tick GATE overlays on an answered-and-marked question.
        <span
          className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full"
          style={{ background: '#1e8449', border: '1.5px solid #fff' }}
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3.5 8.5 6.3 11 12 4.5"
              stroke="#fff"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </button>
  );
}

export default function QuestionPalette({ questions, stateOf, activeIdx, onJump, onClose }) {
  const counts = { notVisited: 0, notAnswered: 0, answered: 0, marked: 0, answeredMarked: 0 };
  const states = questions.map((q, i) => {
    const s = stateOf(q, i);
    counts[s] += 1;
    return s;
  });

  return (
    <>
      {/* On a phone the panel cannot share the row with the question — it would
          be pushed off the side of the screen and be unreachable. Below `md` it
          becomes a drawer over the question instead, with a backdrop to dismiss. */}
      <button
        type="button"
        aria-label="Close the palette"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/40 md:hidden"
      />

      <aside className="fixed inset-y-0 right-0 z-40 flex w-72 max-w-[85vw] flex-col border-l bg-[var(--surface)] shadow-xl md:static md:h-full md:max-w-none md:shrink-0 md:shadow-none">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-bold">Question palette</h2>
        <button
          className="ml-auto rounded p-1 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          onClick={onClose}
          aria-label="Close the palette"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {questions.map((q, i) => (
            <Swatch
              key={q.id}
              state={states[i]}
              size={38}
              active={i === activeIdx}
              onClick={() => onJump(i)}
              title={`${i + 1}. ${q.title} — ${PALETTE_STATES[states[i]].label}`}
            >
              {i + 1}
            </Swatch>
          ))}
        </div>

        <div className="mt-5 border-t pt-4">
          <p className="eyebrow mb-2.5">Legend</p>
          <ul className="flex flex-col gap-2.5">
            {Object.entries(PALETTE_STATES).map(([key, s]) => (
              <li key={key} className="flex items-start gap-2.5">
                <Swatch state={key} size={24}>
                  {counts[key]}
                </Swatch>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-xs font-semibold">{s.label}</span>
                  <span className="block text-[0.68rem] leading-snug text-[var(--text-muted)]">
                    {s.help}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p
          className="mt-4 rounded-md px-3 py-2 text-[0.7rem] leading-snug"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
        >
          Marking a question for review is only a bookmark for you. It changes nothing about how it
          is marked — an answered question still counts, marked or not.
        </p>
      </div>
      </aside>
    </>
  );
}
