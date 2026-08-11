import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Spinner } from '../../components/ui.jsx';

/** <input type="datetime-local"> wants local time with no timezone suffix. */
const toLocalInput = (value) => {
  const d = value ? new Date(value) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function emptyTest() {
  const start = new Date(Date.now() + 10 * 60_000);
  const end = new Date(Date.now() + 130 * 60_000);
  return {
    title: '',
    description: '',
    startAt: toLocalInput(start),
    endAt: toLocalInput(end),
    durationMinutes: 60,
    allowedLanguages: ['python', 'cpp', 'java'],
    questions: [],
    questionsPerStudent: 0,
    randomizeOrder: false,
    warningLimit: 3,
    graceMs: 2500,
    fullscreenGraceSec: 15,
    isPractice: false,
  };
}

export function fromTest(test) {
  return {
    title: test.title,
    description: test.description || '',
    startAt: toLocalInput(test.startAt),
    endAt: toLocalInput(test.endAt),
    durationMinutes: test.durationMinutes,
    allowedLanguages: test.allowedLanguages,
    questions: (test.questions || []).map((q) => q.id || q),
    questionsPerStudent: test.questionsPerStudent || 0,
    randomizeOrder: Boolean(test.randomizeOrder),
    warningLimit: test.warningLimit,
    graceMs: test.graceMs ?? 2500,
    fullscreenGraceSec: test.fullscreenGraceSec ?? 15,
    isPractice: Boolean(test.isPractice),
  };
}

/** Converts the form's local-time strings back into ISO for the API. */
export function toPayload(form) {
  return {
    ...form,
    startAt: new Date(form.startAt).toISOString(),
    endAt: new Date(form.endAt).toISOString(),
    durationMinutes: Number(form.durationMinutes),
    questionsPerStudent: Number(form.questionsPerStudent),
    warningLimit: Number(form.warningLimit),
    graceMs: Number(form.graceMs),
    fullscreenGraceSec: Number(form.fullscreenGraceSec),
  };
}

export default function TestForm({ value, onChange, onSubmit, submitting, submitLabel, footer }) {
  const [languages, setLanguages] = useState([]);
  const [library, setLibrary] = useState([]);

  useEffect(() => {
    api.get('/languages').then((d) => setLanguages(d.languages)).catch(() => {});
    api.get('/questions').then((d) => setLibrary(d.questions)).catch(() => {});
  }, []);

  const set = (patch) => onChange({ ...value, ...patch });

  const toggleLanguage = (key) => {
    const next = value.allowedLanguages.includes(key)
      ? value.allowedLanguages.filter((l) => l !== key)
      : [...value.allowedLanguages, key];
    if (next.length) set({ allowedLanguages: next });
  };

  const toggleQuestion = (id) => {
    const next = value.questions.includes(id)
      ? value.questions.filter((q) => q !== id)
      : [...value.questions, id];
    set({ questions: next });
  };

  const totalMarks = library
    .filter((q) => value.questions.includes(q.id))
    .reduce((sum, q) => sum + q.marks, 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Basics</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="t-title">
              Title
            </label>
            <input
              id="t-title"
              className="input"
              required
              value={value.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Data Structures — Mid-semester Test"
            />
          </div>
          <div>
            <label className="label" htmlFor="t-desc">
              Description (shown to students before they start)
            </label>
            <textarea
              id="t-desc"
              className="textarea"
              rows={2}
              style={{ fontFamily: 'inherit' }}
              value={value.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.isPractice}
              onChange={(e) => set({ isPractice: e.target.checked })}
            />
            This is a practice test — students use it to learn the interface
          </label>
        </div>
      </section>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Schedule</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="t-start">
              Opens
            </label>
            <input
              id="t-start"
              type="datetime-local"
              className="input"
              required
              value={value.startAt}
              onChange={(e) => set({ startAt: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="t-end">
              Closes
            </label>
            <input
              id="t-end"
              type="datetime-local"
              className="input"
              required
              value={value.endAt}
              onChange={(e) => set({ endAt: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="t-dur">
              Duration per student (min)
            </label>
            <input
              id="t-dur"
              type="number"
              min={1}
              max={1440}
              className="input"
              required
              value={value.durationMinutes}
              onChange={(e) => set({ durationMinutes: e.target.value })}
            />
          </div>
        </div>
        <p className="hint">
          Each student gets their own clock when they start. It always stops at the closing time,
          whichever comes first.
        </p>
      </section>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Languages</h2>
        <div className="flex flex-wrap gap-2">
          {languages.map((lang) => {
            const on = value.allowedLanguages.includes(lang.key);
            return (
              <button
                key={lang.key}
                type="button"
                onClick={() => toggleLanguage(lang.key)}
                className="btn btn-sm"
                style={{
                  background: on ? 'var(--color-brand-600)' : 'transparent',
                  color: on ? '#fff' : 'var(--text)',
                  borderColor: on ? 'var(--color-brand-600)' : 'var(--border-strong)',
                }}
              >
                {lang.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold">Questions</h2>
          <span className="badge badge-muted">
            {value.questions.length} selected · {totalMarks} marks
          </span>
        </div>

        {!library.length ? (
          <p className="text-sm text-[var(--text-muted)]">
            Your question library is empty. Create a question first, then come back.
          </p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {library.map((q) => {
              const on = value.questions.includes(q.id);
              return (
                <label
                  key={q.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: on ? 'var(--color-brand-500)' : 'var(--border)',
                    background: on ? 'var(--color-brand-50)' : 'transparent',
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleQuestion(q.id)} />
                  <span className="flex-1 truncate font-medium">{q.title}</span>
                  <span className="badge badge-muted">{q.difficulty}</span>
                  <span className="text-xs text-[var(--text-muted)]">{q.marks} marks</span>
                  {q.kind === 'coding' ? (
                    <span className="text-xs text-[var(--text-faint)]">{q.caseCount} cases</span>
                  ) : (
                    <span className="badge badge-muted">
                      {q.kind === 'nat' ? 'NAT' : q.multiSelect ? 'MSQ' : 'MCQ'}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t-per">
              Questions given to each student
            </label>
            <input
              id="t-per"
              type="number"
              min={0}
              max={value.questions.length}
              className="input"
              value={value.questionsPerStudent}
              onChange={(e) => set({ questionsPerStudent: e.target.value })}
            />
            <p className="hint">
              0 gives everyone all {value.questions.length}. A smaller number draws a different
              random subset per student.
            </p>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.randomizeOrder}
                onChange={(e) => set({ randomizeOrder: e.target.checked })}
              />
              Randomise question order per student
            </label>
          </div>
        </div>
      </section>

      <section className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Exam rules</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="t-warn">
              Warning limit
            </label>
            <input
              id="t-warn"
              type="number"
              min={1}
              max={20}
              className="input"
              value={value.warningLimit}
              onChange={(e) => set({ warningLimit: e.target.value })}
            />
            <p className="hint">
              Exceeding this ends the attempt, auto-submits their current code and grades it. It is
              never zeroed — you make the final call with the score override.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="t-grace">
              Grace period (ms)
            </label>
            <input
              id="t-grace"
              type="number"
              min={0}
              max={15000}
              step={500}
              className="input"
              value={value.graceMs}
              onChange={(e) => set({ graceMs: e.target.value })}
            />
            <p className="hint">
              A focus loss shorter than this warns the student on screen without costing a warning.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="label" htmlFor="t-fs">
              Return to fullscreen within (seconds)
            </label>
            <input
              id="t-fs"
              type="number"
              min={0}
              max={300}
              className="input"
              value={value.fullscreenGraceSec}
              onChange={(e) => set({ fullscreenGraceSec: e.target.value })}
            />
            <p className="hint">
              Leaving fullscreen shows the student a countdown. If they do not come back in time the
              attempt ends and their current work is submitted and graded. Set to{' '}
              <strong>0</strong> to switch the deadline off — leaving fullscreen then only costs an
              ordinary warning.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {footer}
        <button className="btn btn-primary" disabled={submitting}>
          {submitting ? <Spinner label="Saving…" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}
