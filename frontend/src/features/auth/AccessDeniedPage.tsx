import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function AccessDeniedPage() {
  return (
    <div className="cs-card cs-state" role="alert">
      <div className="cs-state-icon is-danger"><ShieldAlert size={22} aria-hidden /></div>
      <h2>Access denied</h2>
      <p>Your account does not have permission to view this page. If you think this is a mistake, contact an administrator.</p>
      <Link to="/" className="btn btn-primary btn-sm">Back to dashboard</Link>
    </div>
  );
}
