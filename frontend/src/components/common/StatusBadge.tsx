import type { VmState } from '@/types/api';

const TONE: Record<string, string> = {
  RUNNING: 'success',
  PROVISIONING: 'info',
  REQUESTED: 'info',
  STOPPED: 'neutral',
  TERMINATED: 'neutral',
  PREEMPTED: 'warning',
  FAILED: 'danger',
  ACTIVE: 'success',
  OPEN: 'info',
  PAID: 'success',
  ISSUED: 'info',
  OVERDUE: 'danger',
  DRAFT: 'neutral',
  VOID: 'neutral',
};

export default function StatusBadge({ status }: { status: VmState | string }) {
  const tone = TONE[status] ?? 'neutral';
  return <span className={`cs-badge cs-badge--${tone}`}>{status}</span>;
}
