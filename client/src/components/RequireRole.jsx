import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageLoader } from './ui.jsx';
import ProfileGate from './ProfileGate.jsx';

/**
 * Client-side routing convenience only — every endpoint re-checks the role on
 * the server, so hiding a route here is never the security boundary.
 */
export default function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  /*
   * Ask for a name once, on the first sign-in.
   *
   * Google gives us an email and whatever display name the account happens to
   * carry, which is often a nickname or the local part of the address — no use
   * on a mark sheet. This used to be asked at the moment a student pressed
   * "Start test", which is the worst possible time: the clock is about to
   * start and they are already nervous. Asking here costs nothing.
   *
   * The server still refuses to begin an attempt without it (HTTP 428), so
   * accounts that predate this are caught at the old point rather than slipping
   * through unnamed.
   */
  /*
   * A head of department is asked the same way which department they head.
   *
   * `needsDepartment` is checked separately from `profileComplete` because an
   * account promoted to head after it had already named itself would otherwise
   * never be asked, and the server scopes an unassigned head to nothing — they
   * would sign in to a set of screens that all refused them with no way to say
   * why.
   */
  if (!user.profileComplete || user.needsDepartment) {
    return <ProfileGate firstRun={!user.profileComplete} />;
  }

  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return children;
}
