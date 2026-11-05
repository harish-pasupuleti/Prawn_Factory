import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '../components/ui';
import type { Role } from '../lib/types';
import { useAuth } from './AuthContext';

/** Route guard. This is a usability layer only; the API enforces authorization on every request. */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Restoring your session" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <Outlet />;
}
