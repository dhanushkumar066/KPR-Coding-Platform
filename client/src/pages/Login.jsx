import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageLoader, Spinner } from '../components/ui.jsx';
import Logo from '../components/Logo.jsx';

export default function Login() {
  const { user, config, loading, signInWithGoogle, devSignIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const googleBtnRef = useRef(null);
  const [devEmail, setDevEmail] = useState('');
  const [devRole, setDevRole] = useState('student');
  const [busy, setBusy] = useState(false);

  const redirectTo = location.state?.from?.pathname || '/';

  useEffect(() => {
    if (!config?.googleEnabled || !googleBtnRef.current || user) return;
    let cancelled = false;

    const init = () => {
      if (cancelled || !window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (response) => {
          try {
            await signInWithGoogle(response.credential);
            navigate(redirectTo, { replace: true });
          } catch (err) {
            toast.error(err.message);
          }
        },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 300,
        text: 'signin_with',
      });
      return true;
    };

    if (!init()) {
      // The GSI script is loaded async in index.html; poll briefly for it.
      const timer = setInterval(() => init() && clearInterval(timer), 200);
      setTimeout(() => clearInterval(timer), 8000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [config, user, signInWithGoogle, navigate, redirectTo, toast]);

  const handleDevLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await devSignIn(devEmail.trim(), devRole);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoader />;
  if (user) return <Navigate to={redirectTo} replace />;

  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-10">
      {/* A very faint institutional wash. Enough to stop the page reading as a
          blank sheet, quiet enough not to compete with the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60rem 30rem at 50% -10%, color-mix(in srgb, var(--color-brand-600) 9%, transparent), transparent 70%)',
        }}
      />

      <div className="animate-fade-up relative w-full max-w-md">
        <div className="mb-6 text-center">
          <Logo size={76} className="mx-auto mb-4" />
          <h1 className="text-2xl font-bold tracking-tight">KPR Coding Platform</h1>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-[var(--text-muted)]">
            Sign in with your college Google account to continue.
          </p>
        </div>

        <div className="card px-6 py-6" style={{ boxShadow: 'var(--shadow-md)' }}>
          {config?.googleEnabled ? (
            <div className="flex flex-col items-center gap-3">
              <div ref={googleBtnRef} />
              {config.allowedEmailDomain && (
                <p className="text-center text-xs text-[var(--text-faint)]">
                  Only <span className="font-semibold">@{config.allowedEmailDomain}</span> accounts
                  are permitted.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-3 text-center text-sm text-[var(--text-muted)]">
              Google sign-in is not configured yet.
              <br />
              <span className="text-xs">
                Set <code className="mono">GOOGLE_CLIENT_ID</code> in{' '}
                <code className="mono">server/.env</code>.
              </span>
            </div>
          )}

          {config?.devLoginEnabled && (
            <form onSubmit={handleDevLogin} className="mt-6 border-t pt-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--warn)]">
                <span className="badge badge-warn">Dev only</span>
                Password-less sign-in
              </p>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="label" htmlFor="dev-email">
                    Email
                  </label>
                  <input
                    id="dev-email"
                    className="input"
                    type="email"
                    required
                    placeholder="student@college.edu"
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="dev-role">
                    Role (only applied when the account is first created)
                  </label>
                  <select
                    id="dev-role"
                    className="select"
                    value={devRole}
                    onChange={(e) => setDevRole(e.target.value)}
                  >
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? <Spinner label="Signing in…" /> : 'Continue'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-[var(--text-faint)]">
          Access to each test is granted by your teacher&apos;s allowlist and its scheduled window.
        </p>
      </div>
    </div>
  );
}
