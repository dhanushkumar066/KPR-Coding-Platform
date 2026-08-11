import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { ErrorState, PageHeader, PageLoader, Stat } from '../../components/ui.jsx';

/**
 * The head of department's staff list.
 *
 * Everything here is scoped to one department — this is a head of department,
 * not a college-wide administrator, and the server enforces that regardless of
 * what this screen sends.
 *
 * The important behaviour is that access is granted by **email, before that
 * person has ever signed in**. The alternative — they sign in, land on a student
 * dashboard, telephone the head, get promoted, refresh — is not something anyone
 * should have to do on the morning of an exam.
 */
export default function AdminUsers() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, users: [] });
  const [stats, setStats] = useState(null);
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');

  const [email, setEmail] = useState('');
  const [grantRole, setGrantRole] = useState('teacher');
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const [staff, statsRes] = await Promise.all([
        api.get(`/admin/users?${params}`),
        api.get('/admin/stats').catch(() => null),
      ]);
      setStats(statsRes);
      setDepartment(staff.department || '');
      setState({ loading: false, error: null, users: staff.users });
    } catch (error) {
      setState({ loading: false, error, users: [] });
    }
  }, [search]);

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  const grant = async (e) => {
    e.preventDefault();
    setGranting(true);
    try {
      const { created, user } = await api.post('/admin/staff', {
        email: email.trim(),
        role: grantRole,
      });
      toast.success(
        created
          ? `${user.email} can sign in as ${user.role === 'admin' ? 'a head' : 'a teacher'} straight away`
          : `${user.email} is now ${user.role === 'admin' ? 'a head' : 'a teacher'} in ${department}`
      );
      setEmail('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGranting(false);
    }
  };

  const revoke = async (person) => {
    const what =
      person.role === 'admin'
        ? `Remove ${person.email} as a head of ${department}?`
        : `Remove ${person.email}'s access to set tests?`;
    if (!window.confirm(`${what}\n\nTheir tests, questions and every result they recorded are kept.`))
      return;
    try {
      await api.del(`/admin/staff/${person.id}`);
      toast.success('Access removed — their work is kept');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeRole = async (id, nextRole) => {
    try {
      await api.patch(`/admin/users/${id}/role`, { role: nextRole });
      toast.success('Updated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (state.loading && !state.users.length) return <PageLoader label="Loading your staff…" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const heads = state.users.filter((u) => u.role === 'admin');

  return (
    <>
      <PageHeader
        title={`${department} — staff`}
        subtitle="Decide who may set tests for this department. Everything here stays inside it."
      />

      {stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Teachers" value={stats.teachers} />
          <Stat label="Heads" value={stats.heads} />
          <Stat label="Tests set" value={stats.tests} />
          <Stat
            label="Judge"
            value={stats.executor?.ok ? 'Ready' : 'Unavailable'}
            tone={stats.executor?.ok ? undefined : 'bad'}
          />
        </div>
      )}

      {/* ------------------------------------------------------------- grant */}
      <form onSubmit={grant} className="card mb-4 px-5 py-4">
        <h2 className="mb-1 text-sm font-bold">Give someone access</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          They do not need an account yet. Add the address now and their first sign-in lands them
          straight on the teaching screens.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="grant-email">
              College email
            </label>
            <input
              id="grant-email"
              type="email"
              required
              className="input min-w-0"
              placeholder="lecturer@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="grant-role">
              As
            </label>
            <select
              id="grant-role"
              className="select w-auto"
              value={grantRole}
              onChange={(e) => setGrantRole(e.target.value)}
            >
              <option value="teacher">Teacher — sets tests</option>
              <option value="admin">Head — also appoints staff</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={granting || !email.trim()}>
            {granting ? 'Adding…' : 'Give access'}
          </button>
        </div>
        {grantRole === 'admin' && (
          <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>
            A second head can appoint and remove staff in {department}, including you. Useful so the
            department is not locked out if you lose your account.
          </p>
        )}
      </form>

      <div className="mb-3">
        <input
          className="input w-auto max-w-72"
          placeholder="Search staff…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Email</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Last signed in</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {state.users.map((u) => {
              const lastHead = u.role === 'admin' && heads.length <= 1;
              return (
                <tr key={u.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3">
                    <span className="font-medium">{u.name || '—'}</span>
                    {u.isYou && <span className="badge badge-muted ml-2">you</span>}
                  </td>
                  <td className="px-4 py-3 mono text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      className="select w-auto py-1 text-xs"
                      value={u.role}
                      disabled={u.isYou || lastHead}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      title={
                        u.isYou
                          ? 'You cannot change your own role'
                          : lastHead
                            ? `${department} must keep at least one head`
                            : undefined
                      }
                    >
                      <option value="teacher">Teacher</option>
                      <option value="admin">Head</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {u.signedIn ? (
                      formatDateTime(u.lastLoginAt)
                    ) : (
                      <span className="badge badge-warn">invited, not signed in</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <button
                        className="btn btn-ghost btn-sm text-[var(--bad)]"
                        disabled={u.isYou || lastHead}
                        onClick={() => revoke(u)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Removing someone returns them to a student account. Their tests, questions and every result
        they recorded stay exactly where they are — those are college records, and they have to
        outlive whoever happened to set them.
      </p>
    </>
  );
}
