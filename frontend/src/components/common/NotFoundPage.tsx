import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="cs-card cs-state">
      <div className="cs-state-icon"><Compass size={22} aria-hidden /></div>
      <h2>Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <Link to="/" className="btn btn-primary btn-sm">Back to dashboard</Link>
    </div>
  );
}
