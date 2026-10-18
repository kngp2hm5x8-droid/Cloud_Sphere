import PlannedModule from '@/components/common/PlannedModule';

export default function AdminAuditPage() {
  return <PlannedModule title="Audit log" subtitle="Read-only audit records." endpoints={['GET /api/v1/admin/audit']} />;
}
