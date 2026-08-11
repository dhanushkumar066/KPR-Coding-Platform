import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from './Logo.jsx';

const NAV_BY_ROLE = {
  student: [
    { to: '/tests', label: 'My tests' },
    { to: '/results', label: 'Results' },
  ],
  teacher: [
    { to: '/teacher', label: 'Tests' },
    { to: '/teacher/questions', label: 'Question library' },
  ],
  // A head of department does everything a teacher does, plus their own
  // department's staff and results. "Users" was the old college-wide wording;
  // a head only ever sees their own department, so the label says so.
  admin: [
    { to: '/teacher', label: 'Tests' },
    { to: '/teacher/questions', label: 'Question library' },
    { to: '/admin/analytics', label: 'Department results' },
    { to: '/admin/users', label: 'Staff' },
  ],
};

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const links = NAV_BY_ROLE[user?.role] || [];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4">
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-2.5 font-bold tracking-tight transition-opacity hover:opacity-80"
          >
            <Logo size={30} />
            <span className="hidden text-[0.95rem] sm:inline">KPR Coding Platform</span>
          </NavLink>

          {/* Scrolls rather than wraps on a narrow screen, so the header keeps
              its single-row height on a 1366-wide lab monitor. */}
          <nav className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/teacher'}
                className={({ isActive }) =>
                  `relative whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:transition-colors ${
                    isActive
                      ? 'text-[var(--color-brand-600)] after:bg-[var(--color-brand-600)]'
                      : 'text-[var(--text-muted)] after:bg-transparent hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{user?.name}</p>
              <p className="text-[0.7rem] uppercase tracking-wide text-[var(--text-faint)]">
                {user?.role}
              </p>
            </div>
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <span
                className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white"
                style={{ background: 'var(--color-accent-600)' }}
              >
                {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
