import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}

export default function StatCard({ label, value, hint, icon: Icon, className = '' }: Props) {
  return (
    <div className={`cs-card cs-card-body h-100 d-flex justify-content-between gap-2 ${className}`}>
      <div>
        <div className="cs-stat-label">{label}</div>
        <div className="cs-stat-value">{value}</div>
        {hint && <div className="cs-stat-hint">{hint}</div>}
      </div>
      {Icon && (
        <div className="cs-stat-icon"><Icon size={19} aria-hidden /></div>
      )}
    </div>
  );
}
