import { useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { EmptyState, Spinner } from '../../../components/ui.jsx';

/**
 * The per-test allowlist (§5). This list, plus the schedule and Google sign-in,
 * is what actually grants access — the test link grants nothing on its own.
 */
export default function AllowlistTab({ test, onChanged }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [emails, setEmails] = useState(test.allowlist || []);
  const [paste, setPaste] = useState('');
  const [mode, setMode] = useState('append');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const apply = (result) => {
    setEmails(result.allowlist);
    onChanged?.();
  };

  const submitPaste = async (e) => {
    e.preventDefault();
    if (!paste.trim()) return;
    setBusy(true);
    try {
      const res = await api.post(`/tests/${test._id}/allowlist`, { text: paste, mode });
      apply(res);
      setPaste('');
      toast.success(`${res.added} address(es) read — ${res.total} students can now sit this test`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('mode', mode);
      const res = await api.post(`/tests/${test._id}/allowlist/upload`, body);
      apply(res);
      toast.success(`${res.added} address(es) from ${res.source} — ${res.total} total`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeEmail = async (email) => {
    try {
      const res = await api.del(`/tests/${test._id}/allowlist/${encodeURIComponent(email)}`);
      apply(res);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const shown = filter
    ? emails.filter((e) => e.toLowerCase().includes(filter.toLowerCase()))
    : emails;

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-4">
        <section className="card px-5 py-4">
          <h2 className="text-sm font-bold">Add students</h2>
          <p className="hint mb-3">
            Upload a CSV or Excel file, or paste addresses. Every cell is scanned, so a class list
            exported from anywhere usually just works.
          </p>

          <div className="mb-3 flex gap-2">
            {['append', 'replace'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="btn btn-sm"
                style={{
                  background: mode === m ? 'var(--color-brand-600)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--text)',
                  borderColor: mode === m ? 'var(--color-brand-600)' : 'var(--border-strong)',
                }}
              >
                {m === 'append' ? 'Add to list' : 'Replace list'}
              </button>
            ))}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xlsm"
            className="input mb-3 file:mr-2 file:rounded file:border-0 file:bg-[var(--surface-3)] file:px-2 file:py-1 file:text-xs"
            onChange={(e) => upload(e.target.files?.[0])}
            disabled={busy}
          />

          <form onSubmit={submitPaste}>
            <label className="label" htmlFor="paste">
              …or paste emails
            </label>
            <textarea
              id="paste"
              className="textarea"
              rows={5}
              placeholder={'anita@college.edu\nbenson@college.edu'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button className="btn btn-primary btn-sm mt-2 w-full" disabled={busy || !paste.trim()}>
              {busy ? <Spinner label="Adding…" /> : 'Add pasted addresses'}
            </button>
          </form>
        </section>

      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-bold">
            Allowed students <span className="badge badge-muted ml-1">{emails.length}</span>
          </h2>
          <input
            className="input ml-auto w-auto max-w-56 py-1 text-xs"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {!emails.length ? (
          <EmptyState
            title="Nobody can sit this test yet"
            body="Add the class list on the left. Only these Google accounts will be able to enter, and only inside the scheduled window."
          />
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {shown.map((email) => (
              <li key={email} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="mono flex-1 truncate">{email}</span>
                <button
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--bad)]"
                  onClick={() => removeEmail(email)}
                >
                  Remove
                </button>
              </li>
            ))}
            {!shown.length && (
              <li className="px-4 py-3 text-sm text-[var(--text-muted)]">No matches.</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
