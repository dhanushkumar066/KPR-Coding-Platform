import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { Spinner } from '../../../components/ui.jsx';
import TestForm, { fromTest, toPayload } from '../TestForm.jsx';

/**
 * Adding a question while students are working. The ordinary settings save
 * refuses to change the paper mid-exam, so this is the deliberate exception —
 * separate, explicit, and append-only.
 */
function AddQuestionLive({ test, onChanged }) {
  const toast = useToast();
  const [library, setLibrary] = useState([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get('/questions')
      .then((d) => setLibrary(d.questions))
      .catch(() => {});
  }, []);

  const inTest = new Set((test.questions || []).map((q) => String(q.id ?? q)));
  const available = library.filter((q) => !inTest.has(String(q.id)));

  const add = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/tests/${test._id}/questions`, { questionId: choice });
      toast.success(res.message);
      setChoice('');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card px-5 py-4">
      <h2 className="mb-1 text-sm font-bold">Add a question now</h2>
      <p className="hint mb-3">
        Students already sitting this test receive it immediately and their total marks go up
        accordingly. Use it to hand out an extra question, not to swap the paper underneath them.
      </p>

      {!available.length ? (
        <p className="text-sm text-[var(--text-muted)]">
          Every question in your library is already in this test.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <select
            className="select flex-1"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Choose a question…</option>
            {available.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title} — {q.marks} marks
                {q.kind === 'coding' ? `, ${q.caseCount} cases` : `, ${q.kind === 'nat' ? 'NAT' : 'MCQ'}`}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={add} disabled={!choice || busy}>
            {busy ? <Spinner label="Adding…" /> : 'Add to live test'}
          </button>
        </div>
      )}

      {test.questionsPerStudent > 0 && (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-xs"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
        >
          This test draws {test.questionsPerStudent} random questions per student, so a new question
          joins the pool for students who start from now. Those already working keep the paper they
          were given.
        </p>
      )}
    </section>
  );
}

/**
 * Runs every coding question in the paper against its own reference solution.
 *
 * Publishing is blocked until each one is proven answerable, and clearing a
 * twelve-question paper one question at a time is tedious enough that a teacher
 * in a hurry would go looking for a way around the check.
 */
function VerifyQuestions({ test, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const run = async () => {
    setBusy(true);
    setResults(null);
    try {
      const res = await api.post(`/tests/${test._id}/verify-questions`);
      setResults(res);
      if (res.verified === res.total) {
        toast.success(`All ${res.total} coding question(s) verified — this test can be published`);
      } else {
        toast.warn(`${res.total - res.verified} of ${res.total} still need attention`);
      }
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card px-5 py-4">
      <h2 className="mb-1 text-sm font-bold">Check the questions are answerable</h2>
      <p className="hint mb-3">
        Optional. Runs each coding question against its own reference solution to confirm the
        expected outputs are right. Questions without a reference solution are skipped — you do not
        need to write one for every question, and publishing works without this.
      </p>

      <button className="btn btn-ghost" onClick={run} disabled={busy}>
        {busy ? <Spinner label="Running…" /> : 'Verify every question'}
      </button>

      {results && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {results.results.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-sm">
              <span className={`badge badge-${r.ok ? 'ok' : 'bad'} mt-0.5 shrink-0`}>
                {r.ok ? 'OK' : 'Fix'}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{r.title}</span>
                <span className="ml-1.5 text-xs text-[var(--text-muted)]">{r.note}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SettingsTab({ test, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => fromTest(test));
  const [saving, setSaving] = useState(false);

  const now = Date.now();
  const isLive =
    test.status === 'published' &&
    now >= new Date(test.startAt).getTime() &&
    now <= new Date(test.endAt).getTime();

  const submit = async () => {
    setSaving(true);
    try {
      await api.patch(`/tests/${test._id}`, toPayload(form));
      toast.success('Saved');
      await onSaved?.();
    } catch (err) {
      // The server refuses schedule/paper changes while students are mid-test.
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <VerifyQuestions test={test} onChanged={onSaved} />

      {isLive && <AddQuestionLive test={test} onChanged={onSaved} />}

      <TestForm
        value={form}
        onChange={setForm}
        onSubmit={submit}
        submitting={saving}
        submitLabel="Save changes"
      />
    </div>
  );
}
