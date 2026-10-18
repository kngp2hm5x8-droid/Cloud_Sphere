import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Info, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api-client';

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="cs-card cs-card-body" role="status" aria-live="polite" aria-label="Loading">
      <div className="placeholder-glow">
        {Array.from({ length: rows }).map((_, i) => (
          <span key={i} className="placeholder col-12 mb-2 d-block rounded" style={{ height: 18, opacity: 0.55 }} />
        ))}
      </div>
    </div>
  );
}

interface ErrorProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: ErrorProps) {
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <div className="cs-card cs-state" role="alert">
      <div className="cs-state-icon is-danger"><AlertTriangle size={22} aria-hidden /></div>
      <h2>{title}</h2>
      <p>{message}</p>
      {code && <p className="small mb-2">Error code: <span className="cs-endpoint">{code}</span></p>}
      {onRetry && (
        <button className="btn btn-outline-primary btn-sm" onClick={onRetry}>
          <RefreshCw size={14} className="me-1" aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="cs-card cs-state">
      <div className="cs-state-icon"><Inbox size={22} aria-hidden /></div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/** Honest placeholder for functionality whose backend endpoint is not available. No fake data. */
export function FeatureUnavailable({ title, description, endpoints }: { title: string; description?: string; endpoints?: string[] }) {
  return (
    <div className="cs-card cs-state">
      <div className="cs-state-icon is-info"><Info size={22} aria-hidden /></div>
      <h2>{title}</h2>
      <p>{description ?? 'This feature is not connected to the backend yet, so nothing is shown here.'}</p>
      {endpoints && endpoints.length > 0 && (
        <div>
          <div className="small text-muted mb-1">Backend endpoints this page will use:</div>
          {endpoints.map((e) => (
            <span key={e} className="cs-endpoint">{e}</span>
          ))}
        </div>
      )}
    </div>
  );
}
