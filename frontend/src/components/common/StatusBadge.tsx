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
  FULFILLED: 'success',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
  PAID: 'success',
  ISSUED: 'info',
  OVERDUE: 'danger',
  DRAFT: 'neutral',
  VOID: 'neutral',
  ATTACHED: 'success',
  AVAILABLE: 'info',
  DELETED: 'neutral',
  COMPLETED: 'success',
  PENDING: 'info',
  EXPIRED: 'warning',
  ALLOW: 'success',
  DENY: 'danger',
  INGRESS: 'info',
  EGRESS: 'neutral',
  SUCCEEDED: 'success',
  REFUNDED: 'warning',
  BREACH: 'danger',
  COMPLIANT: 'success',
  SCALE_UP: 'warning',
  SCALE_DOWN: 'info',
  TERMINATE_IDLE: 'danger',
  RIGHTSIZE: 'info',
  COST_SAVING: 'success',
};

export default function StatusBadge({ status }: { status: VmState | string }) {
  const tone = TONE[status] ?? 'neutral';
  return <span className={`cs-badge cs-badge--${tone}`}>{status}</span>;
}
