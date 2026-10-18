import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import type { Role } from '@/types/api';

// UX gate only. The Express backend enforces every permission independently.
export default function ProtectedRoute({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, status, error, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="cs-auth" role="status" aria-live="polite">
        <div className="spinner-border text-light" aria-label="Loading session" />
      </div>
    );
  }
  if (status === 'unavailable') {
    return (
      <div className="cs-auth">
        <div className="cs-card cs-auth-card text-center" role="alert">
          <div className="cs-state-icon is-danger"><WifiOff size={22} aria-hidden /></div>
          <h2 className="h5">Cannot reach the API</h2>
          <p className="text-muted small">{error}</p>
          <button className="btn btn-primary" onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }
  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (role && user.role !== role) {
    return <Navigate to="/forbidden" replace />;
  }
  return <>{children}</>;
}
