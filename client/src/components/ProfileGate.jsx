import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner } from './ui.jsx';
import Logo from './Logo.jsx';

/**
 * Collects the student's own name, so results are attributable to a person
 * rather than to an email address.
 *
 * Shown once on the first sign-in (`firstRun`), and again from the exam if an
 * account somehow reaches a test without it — the server refuses to start an
 * attempt until this is done (HTTP 428), so it is not merely cosmetic.
 */
export default function ProfileGate({ onDone, onCancel, firstRun = false }) {
  const { user, refresh, signOut } = useAuth();
  const toast = useToast();

  // Pre-fill from the sign-in name, but only when it looks like a real name
  // rather than the local part of an email.
  const suggested = user?.name && user.name !== user.email?.split('@')[0] ? user.name : '';

  const [name, setName] = useState(suggested);
  const [rollNumber, setRollNumber] = useState(user?.rollNumber || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [saving, setSaving] = useState(false);

  // A head of department is asked which department, once, right here — the same
  // moment and the same form as everyone else confirming who they are. Until
  // they answer, the server scopes them to nothing and every staff screen is
  // closed to them, so there is no useful state where this is left blank.
  const needsDepartment = Boolean(user?.needsDepartment);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch('/auth/profile', {
        name: name.trim(),
        rollNumber: rollNumber.trim(),
        ...(needsDepartment ? { department: department.trim() } : {}),
      });
      await refresh();
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="animate-fade-up card w-full max-w-md overflow-hidden">
        <div className="border-b px-6 py-5">
          {firstRun && <Logo size={44} className="mb-3" />}
          <h1 className="text-lg font-bold tracking-tight">
            {needsDepartment
              ? 'Welcome — which department do you head?'
              : firstRun
                ? 'Welcome — what should we call you?'
                : 'Confirm who you are'}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {needsDepartment
              ? 'Asked once. You will appoint your own teaching staff and see your own department’s results — nothing outside it.'
              : firstRun
                ? 'Just once, so your work is recorded under your name instead of your email address. Your teacher sees this on the result sheet.'
                : 'Your teacher sees this on the result sheet, so enter your name exactly as it appears on the college register.'}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-5">
          <div>
            <label className="label" htmlFor="pf-name">
              Full name
            </label>
            <input
              id="pf-name"
              className="input"
              required
              minLength={2}
              autoFocus
              placeholder="Priya Nair"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {needsDepartment ? (
            <div>
              <label className="label" htmlFor="pf-dept">
                Department
              </label>
              <input
                id="pf-dept"
                className="input"
                required
                placeholder="Computer Science and Engineering"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Write it the way your college does. Everything you appoint and every result you see
                is filed under this name, and only another head of this department can change it.
              </p>
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="pf-roll">
                Roll number <span className="font-normal text-[var(--text-faint)]">(optional)</span>
              </label>
              <input
                id="pf-roll"
                className="input mono"
                placeholder="CS21001"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
              />
            </div>
          )}

          <p className="hint">
            Signed in as <span className="mono">{user?.email}</span>. You can change these later
            from your account, but not once a test is in progress.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-[var(--surface-2)] px-6 py-4">
          {/* No way back on the first run — there is nothing behind this yet,
              and a "skip" would only produce an unnamed row on a mark sheet. */}
          {onCancel && !firstRun && (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Back
            </button>
          )}
          {firstRun && (
            <button type="button" className="btn btn-ghost mr-auto" onClick={signOut}>
              Sign out
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={saving || name.trim().length < 2 || (needsDepartment && !department.trim())}
          >
            {saving ? <Spinner label="Saving…" /> : firstRun ? 'Continue' : 'Save and continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
