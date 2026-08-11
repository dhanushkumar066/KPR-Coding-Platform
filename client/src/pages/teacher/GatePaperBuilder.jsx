import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { gateMarking, gateMarkingFields } from '../../lib/gateMarking.js';
import Markdown from '../../components/Markdown.jsx';

/**
 * Write a whole GATE paper as one long page.
 *
 * Every question is on screen at once and stays there — no stepping forward one
 * at a time, so a teacher can scroll back, compare, and fix Q4 while writing
 * Q40. Each question carries its own type, so a paper mixes MCQ, MSQ and NAT in
 * whatever order the paper actually runs.
 *
 * Each question saves itself as it is typed, and is attached to a draft test
 * straight away, so a closed tab never costs an afternoon's work. Publishing is
 * deliberately NOT reimplemented here: when the questions are written, this
 * hands over to the ordinary test screen, where a GATE paper gets the same
 * students, window, share link and publish button as every other test.
 */

const SECTIONS = ['General Aptitude', 'Core Subject'];

const TYPES = {
  mcq: { label: 'MCQ — one correct', badge: 'MCQ' },
  msq: { label: 'MSQ — several correct', badge: 'MSQ' },
  nat: { label: 'NAT — type a number', badge: 'NAT' },
};

let seq = 0;
const newKey = () => `row-${++seq}`;

const blankRow = (inherit = {}) => ({
  key: newKey(),
  id: null,
  // A new question inherits the last one's settings, which is what makes a run
  // of six aptitude MCQs six statements and nothing else.
  section: inherit.section || SECTIONS[0],
  type: inherit.type || 'mcq',
  marks: inherit.marks || 1,
  statement: '',
  options: [
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
    { text: '', isCorrect: false },
  ],
  natMin: '',
  natMax: '',
  natUnit: '',
  status: 'blank',
  message: '',
});

/** Does this statement embed an image? Matches the markdown the upload inserts. */
const hasImage = (statement) => /!\[[^\]]*\]\([^)\s]+\)/.test(statement || '');

/** What is missing from a question, in plain words. Empty means it can save. */
function problemWith(row) {
  if (!row.statement.trim()) return 'Type the question.';
  if (row.type === 'nat') {
    const min = Number(row.natMin);
    const max = row.natMax === '' ? min : Number(row.natMax);
    if (row.natMin === '' || Number.isNaN(min)) return 'Give the accepted answer.';
    if (Number.isNaN(max)) return 'That upper bound is not a number.';
    if (max < min) return 'The upper bound is below the lower one.';
    return '';
  }
  const filled = row.options.filter((o) => o.text.trim());
  if (filled.length < 2) return 'Give at least two options.';
  const correct = filled.filter((o) => o.isCorrect);
  if (!correct.length) return 'Tick the correct answer.';
  if (row.type === 'mcq' && correct.length > 1) return 'An MCQ has exactly one correct answer.';
  return '';
}

/** The payload a row becomes on the server. */
function rowToBody(row) {
  return {
    style: 'gate',
    kind: row.type === 'nat' ? 'nat' : 'mcq',
    section: row.section,
    marks: Number(row.marks),
    // GATE questions have no heading of their own — the statement is the
    // question, so its first line stands in as the library title.
    title: row.statement.trim().split('\n')[0].slice(0, 90),
    statement: row.statement.trim(),
    ...(row.type === 'nat'
      ? {
          nat: {
            answerMin: Number(row.natMin),
            answerMax: row.natMax === '' ? Number(row.natMin) : Number(row.natMax),
            unit: row.natUnit.trim(),
          },
        }
      : {
          mcq: {
            multiSelect: row.type === 'msq',
            ...gateMarkingFields(row.type),
            options: row.options
              .filter((o) => o.text.trim())
              .map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })),
          },
        }),
  };
}

export default function GatePaperBuilder() {
  const { testId: routeTestId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [testId, setTestId] = useState(routeTestId || null);
  const [rows, setRows] = useState(() => [blankRow()]);
  const [loading, setLoading] = useState(Boolean(routeTestId));
  const [fatal, setFatal] = useState('');

  // One in-flight test creation, however many rows finish typing at once.
  const testPromise = useRef(null);
  const testIdRef = useRef(routeTestId || null);
  const timers = useRef({});

  // A debounced save fires long after the render that scheduled it, so it needs
  // the newest rows rather than the ones closed over at schedule time.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!routeTestId) return;
    (async () => {
      try {
        const { test } = await api.get(`/tests/${routeTestId}`);
        const existing = (test.questions || []).map((q) => ({
          ...blankRow(),
          id: q.id || q._id,
          section: q.section || SECTIONS[0],
          type: q.kind === 'nat' ? 'nat' : q.multiSelect ? 'msq' : 'mcq',
          marks: q.marks,
          statement: q.statement || q.title || '',
          options: (q.options || q.mcq?.options || []).map((o) => ({
            text: o.text || '',
            isCorrect: Boolean(o.isCorrect),
          })),
          natMin: q.nat?.answerMin ?? '',
          natMax: q.nat?.answerMax ?? '',
          natUnit: q.nat?.unit || '',
          status: 'saved',
        }));
        setRows(existing.length ? [...existing, blankRow(existing[existing.length - 1])] : [blankRow()]);
      } catch (err) {
        setFatal(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [routeTestId]);

  // Cancel every pending autosave when leaving the page.
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const ensureTest = useCallback(async () => {
    if (testIdRef.current) return testIdRef.current;
    if (testPromise.current) return testPromise.current;

    testPromise.current = (async () => {
      const now = Date.now();
      const { test } = await api.post('/tests', {
        // Named properly on the ordinary test screen, where the teacher does
        // the rest of the publishing.
        title: 'Untitled GATE paper',
        startAt: new Date(now).toISOString(),
        endAt: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
        durationMinutes: 180,
        // A paper of MCQ and NAT questions needs no language, but a test must
        // name at least one. All five, so adding a coding question to this
        // paper later cannot be blocked by a language nobody chose here.
        allowedLanguages: ['python', 'javascript', 'java', 'cpp', 'c'],
        questions: [],
      });
      const id = test._id || test.id;
      testIdRef.current = id;
      setTestId(id);
      window.history.replaceState({}, '', `/teacher/gate/${id}`);
      return id;
    })();

    return testPromise.current;
  }, []);

  const patchRow = useCallback((key, patch) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  /** Writes one question to the server: create the first time, update after. */
  const saveRow = useCallback(
    async (key) => {
      const row = rowsRef.current.find((r) => r.key === key);
      if (!row) return;

      const why = problemWith(row);
      if (why) {
        patchRow(key, { status: row.id ? 'stale' : 'blank', message: why });
        return;
      }

      patchRow(key, { status: 'saving', message: '' });
      try {
        const id = await ensureTest();
        const body = rowToBody(row);

        if (row.id) {
          await api.patch(`/questions/${row.id}`, body);
          patchRow(key, { status: 'saved', message: '' });
        } else {
          const { question } = await api.post('/questions', body);
          const qid = question._id || question.id;
          await api.post(`/tests/${id}/questions`, { questionId: qid });
          patchRow(key, { id: qid, status: 'saved', message: '' });
        }
      } catch (err) {
        patchRow(key, { status: 'error', message: err.message });
      }
    },
    [ensureTest, patchRow]
  );

  /** Edits mark the row dirty and queue a save a moment later. */
  const edit = useCallback(
    (key, patch) => {
      setRows((list) =>
        list.map((r) => (r.key === key ? { ...r, ...patch, status: r.id ? 'stale' : 'blank' } : r))
      );
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => saveRow(key), 900);
    },
    [saveRow]
  );

  const addRow = () =>
    setRows((list) => [...list, blankRow(list[list.length - 1])]);

  const removeRow = async (key) => {
    const row = rows.find((r) => r.key === key);
    clearTimeout(timers.current[key]);
    const remaining = rows.filter((r) => r.key !== key);
    setRows(remaining.length ? remaining : [blankRow()]);

    if (row?.id && testIdRef.current) {
      try {
        await api.patch(`/tests/${testIdRef.current}`, {
          questions: remaining.filter((r) => r.id).map((r) => r.id),
        });
      } catch (err) {
        toast.error(err.message);
      }
    }
  };

  const uploadImage = async (key, file) => {
    if (!file) return;
    const row = rows.find((r) => r.key === key);
    try {
      const body = new FormData();
      body.append('image', file);
      const { markdown } = await api.post('/questions/images', body);
      edit(key, {
        statement: `${row.statement}${row.statement ? '\n\n' : ''}${markdown}`,
      });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saved = rows.filter((r) => r.id);
  const totals = useMemo(() => {
    const total = saved.reduce((s, r) => s + Number(r.marks || 0), 0);
    const aptitude = saved
      .filter((r) => r.section === 'General Aptitude')
      .reduce((s, r) => s + Number(r.marks || 0), 0);
    return { total, aptitude, count: saved.length };
  }, [saved]);

  const unsaved = rows.filter((r) => !r.id && r.statement.trim()).length;

  const goPublish = async () => {
    // Flush anything still on a debounce so nothing is left behind.
    Object.values(timers.current).forEach(clearTimeout);
    await Promise.all(rows.filter((r) => !problemWith(r)).map((r) => saveRow(r.key)));
    if (!testIdRef.current) {
      toast.error('Write at least one question first');
      return;
    }
    navigate(`/teacher/tests/${testIdRef.current}`);
  };

  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading your draft…</p>;
  if (fatal) return <p className="text-sm" style={{ color: 'var(--bad)' }}>{fatal}</p>;

  return (
    <>
      <PageHeader
        title="Build a GATE paper"
        subtitle="Every question stays on the page. Each one saves itself as you type, then you publish it like any other test."
      />

      {/* Running totals, pinned so they stay readable down a long paper. */}
      <div
        className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md px-3.5 py-2.5 text-xs backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--surface-2) 92%, transparent)' }}
      >
        <span>
          <span className="stat-label">Questions</span>{' '}
          <b className="tabular-nums">{totals.count}</b>
        </span>
        <span>
          <span className="stat-label">Total</span> <b className="tabular-nums">{totals.total}</b>
          <span className="text-[var(--text-faint)]"> / 100</span>
        </span>
        <span>
          <span className="stat-label">Aptitude</span>{' '}
          <b className="tabular-nums">{totals.aptitude}</b>
          <span className="text-[var(--text-faint)]"> / 15</span>
        </span>
        {unsaved > 0 && (
          <span className="text-[var(--warn)]">
            {unsaved} not saved yet — finish {unsaved > 1 ? 'them' : 'it'} or remove{' '}
            {unsaved > 1 ? 'them' : 'it'}
          </span>
        )}
        <button className="btn btn-primary btn-sm ml-auto" onClick={goPublish}>
          Continue to publish
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <QuestionRow
            key={row.key}
            row={row}
            number={i + 1}
            onEdit={edit}
            onRemove={removeRow}
            onUpload={uploadImage}
            canRemove={rows.length > 1 || Boolean(row.id)}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost" onClick={addRow}>
          + Add question
        </button>
        <span className="text-xs text-[var(--text-faint)]">
          The new one keeps the section, type and marks of the one above it.
        </span>
      </div>

      <div className="mt-5 border-t pt-4">
        <button className="btn btn-primary" onClick={goPublish}>
          Continue to publish
        </button>
        <p className="mt-1.5 text-xs text-[var(--text-muted)]">
          Takes you to the normal test screen — students, window, share link and publish, exactly as
          for any other test.
        </p>
      </div>
    </>
  );
}

/**
 * The marking, taken straight from GATE's published scheme and derived from the
 * type and weight alone — there is nothing here for a teacher to set, because
 * in GATE there is nothing to choose.
 */
function MarkingLine({ type, marks }) {
  const m = gateMarking(type, marks);
  const cell = (label, text, tone) => (
    <span className="flex items-baseline gap-1">
      <span className="stat-label">{label}</span>
      <b className="tabular-nums" style={tone ? { color: tone } : undefined}>
        {text}
      </b>
    </span>
  );

  return (
    <div
      className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-1.5 text-xs"
      style={{ background: 'var(--surface-2)' }}
    >
      {cell('Correct', `+${m.correct}`, 'var(--ok)')}
      {cell(
        'Wrong',
        // The fraction is the real rule; the decimal is only there for scale.
        m.wrong < 0 ? `${m.wrongLabel} (≈${m.wrongApprox})` : '0',
        m.wrong < 0 ? 'var(--bad)' : undefined
      )}
      {cell('Unattempted', '0')}
      <span className="text-[var(--text-muted)]">{m.detail}</span>
    </div>
  );
}

/** Status shown on each question, so "did that save?" is never a guess. */
function StatusChip({ row }) {
  if (row.status === 'saving') return <span className="badge badge-muted">Saving…</span>;
  if (row.status === 'saved') return <span className="badge badge-ok">Saved</span>;
  if (row.status === 'error') return <span className="badge badge-bad">{row.message}</span>;
  if (row.message) return <span className="badge badge-warn">{row.message}</span>;
  return <span className="badge badge-muted">Not saved yet</span>;
}

function QuestionRow({ row, number, onEdit, onRemove, onUpload, canRemove }) {
  const setOption = (idx, patch) =>
    onEdit(row.key, {
      options: row.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    });

  const chooseCorrect = (idx, checked) => {
    if (row.type === 'msq') return setOption(idx, { isCorrect: checked });
    onEdit(row.key, {
      options: row.options.map((o, i) => ({ ...o, isCorrect: i === idx })),
    });
  };

  return (
    <section className="card min-w-0 px-4 py-3.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Q{number}</span>
        <span className="badge badge-muted">{TYPES[row.type].badge}</span>

        <select
          className="select w-auto py-1 text-xs"
          aria-label={`Question ${number} type`}
          value={row.type}
          onChange={(e) => {
            const type = e.target.value;
            // Coming back to MCQ from MSQ can leave several ticks behind, which
            // is not a state an MCQ is allowed to be in.
            const first = row.options.findIndex((o) => o.isCorrect);
            onEdit(row.key, {
              type,
              ...(type === 'mcq'
                ? { options: row.options.map((o, i) => ({ ...o, isCorrect: i === first })) }
                : {}),
            });
          }}
        >
          {Object.entries(TYPES).map(([k, t]) => (
            <option key={k} value={k}>
              {t.label}
            </option>
          ))}
        </select>

        <input
          className="input w-auto max-w-44 py-1 text-xs"
          aria-label={`Question ${number} section`}
          list="gate-sections"
          value={row.section}
          onChange={(e) => onEdit(row.key, { section: e.target.value })}
        />

        <select
          className="select w-auto py-1 text-xs"
          aria-label={`Question ${number} marks`}
          value={row.marks}
          onChange={(e) => onEdit(row.key, { marks: Number(e.target.value) })}
        >
          <option value={1}>1 mark</option>
          <option value={2}>2 marks</option>
        </select>

        <span className="ml-auto flex items-center gap-2">
          <StatusChip row={row} />
          <label className="btn btn-ghost btn-sm cursor-pointer">
            Image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onUpload(row.key, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {canRemove && (
            <button
              className="btn btn-ghost btn-sm text-[var(--bad)]"
              onClick={() => onRemove(row.key)}
              aria-label={`Remove question ${number}`}
            >
              Remove
            </button>
          )}
        </span>
      </div>

      {/* GATE's own marking for this type and weight, stated before the
          question is written rather than discovered after the exam. */}
      <MarkingLine type={row.type} marks={row.marks} />

      <textarea
        className="input min-h-20 font-normal"
        placeholder="Type the question."
        value={row.statement}
        onChange={(e) => onEdit(row.key, { statement: e.target.value })}
      />

      {/* Adding an image only puts a markdown line in the box, which reads as a
          stray link — there is no way to tell from that whether the right file
          went up, or whether it will show at all. So once a statement contains
          an image, render it exactly as the student will see it. */}
      {hasImage(row.statement) && (
        <div className="mt-2 rounded-md border px-3 py-2" style={{ background: 'var(--surface-2)' }}>
          <p className="eyebrow mb-1.5">What the student sees</p>
          <Markdown className="text-sm">{row.statement}</Markdown>
        </div>
      )}

      {row.type === 'nat' ? (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          <input
            className="input min-w-0"
            inputMode="decimal"
            placeholder="Answer, e.g. 2.4"
            aria-label={`Question ${number} answer`}
            value={row.natMin}
            onChange={(e) => onEdit(row.key, { natMin: e.target.value })}
          />
          <input
            className="input min-w-0"
            inputMode="decimal"
            placeholder="Up to (optional)"
            aria-label={`Question ${number} upper bound`}
            value={row.natMax}
            onChange={(e) => onEdit(row.key, { natMax: e.target.value })}
          />
          <input
            className="input min-w-0"
            placeholder="Unit (optional)"
            aria-label={`Question ${number} unit`}
            value={row.natUnit}
            onChange={(e) => onEdit(row.key, { natUnit: e.target.value })}
          />
          <p className="text-xs text-[var(--text-muted)] sm:col-span-3">
            GATE publishes NAT answers as a range — "2.4 to 2.6" — because a division has no one
            right decimal. Leave the upper bound empty for an exact answer.
          </p>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {row.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={row.type === 'msq' ? 'checkbox' : 'radio'}
                name={`correct-${row.key}`}
                checked={o.isCorrect}
                onChange={(e) => chooseCorrect(i, e.target.checked)}
                aria-label={`Question ${number} option ${String.fromCharCode(65 + i)} is correct`}
              />
              <span className="w-4 shrink-0 text-xs font-bold text-[var(--text-faint)]">
                {String.fromCharCode(65 + i)}
              </span>
              <input
                className="input min-w-0"
                placeholder={`Option ${String.fromCharCode(65 + i)}`}
                value={o.text}
                onChange={(e) => setOption(i, { text: e.target.value })}
              />
            </div>
          ))}
          <button
            className="btn btn-ghost btn-sm self-start"
            onClick={() =>
              onEdit(row.key, { options: [...row.options, { text: '', isCorrect: false }] })
            }
          >
            Add option
          </button>
        </div>
      )}

      <datalist id="gate-sections">
        {SECTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </section>
  );
}
