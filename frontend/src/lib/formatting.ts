// Single place for display formatting. NUMERIC values arrive from the API as strings.
export const CURRENCY_CODE = 'USD'; // simulated currency; change here if the project uses another

const toNumber = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? NaN : Number(value);

export function formatNumber(value: string | number | null | undefined, digits = 0): string {
  const n = toNumber(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n)
    : '—';
}

export function formatCurrency(value: string | number | null | undefined): string {
  const n = toNumber(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY_CODE }).format(n)
    : '—';
}

export function formatPercent(value: string | number | null | undefined, digits = 0): string {
  const n = toNumber(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function percentOf(used: number, max: number): number {
  return max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
}
