import { percentOf } from '@/lib/formatting';

interface Props {
  label: string;
  used: number;
  max: number;
  unit?: string;
}

export default function UsageMeter({ label, used, max, unit = '' }: Props) {
  const pct = percentOf(used, max);
  const tone = pct >= 90 ? 'is-danger' : pct >= 75 ? 'is-warn' : '';
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between small mb-1">
        <span>{label}</span>
        <span className="text-muted">{used}{unit} / {max}{unit} ({pct}%)</span>
      </div>
      <div className={`cs-meter ${tone}`} role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
