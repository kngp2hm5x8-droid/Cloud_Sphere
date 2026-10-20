import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatDateTime } from '@/lib/formatting';

interface AuditRecord {
  audit_id: string; actor_user_id: string | null; actor_name: string | null; action: string;
  entity_type: string; entity_id: string | null; old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null; created_at: string;
}

function Values({ value }: { value: Record<string, unknown> | null }) {
  if (!value || !Object.keys(value).length) return <span className="text-muted">—</span>;
  return <div className="small">{Object.entries(value).map(([key, item]) => <div key={key}><span className="text-muted">{key.replaceAll('_', ' ')}:</span> {typeof item === 'object' ? JSON.stringify(item) : String(item ?? '—')}</div>)}</div>;
}

export default function AdminAuditPage() {
  const query = useQuery({ queryKey: ['admin', 'audit'], queryFn: ({ signal }) => getData<AuditRecord[]>('/admin/audit', undefined, signal) });
  const records = query.data ?? [];

  return <>
    <PageHeader title="Audit log" subtitle="Recent database audit entries for VM lifecycle and administrative changes." />
    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="audit-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="audit-heading"><ScrollText size={17} className="me-2" />Recent activity</h2><p className="small text-muted mb-0">Showing the latest 250 records stored in the audit log.</p></div>{query.data && <span className="small text-muted">{records.length} records</span>}</div>
      {query.isPending && <LoadingBlock rows={5} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load audit records" />}
      {query.data?.length === 0 && <EmptyState title="No audit records" description="Audited lifecycle and administrative changes will appear here." />}
      {!!query.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Before</th><th>After</th></tr></thead><tbody>{records.map((item) => <tr key={item.audit_id}>
        <td className="text-nowrap">{formatDateTime(item.created_at)}</td><td>{item.actor_name ?? (item.actor_user_id ? `User #${item.actor_user_id}` : <span className="text-muted">System</span>)}</td><td><StatusBadge status={item.action} /></td><td><div className="fw-semibold">{item.entity_type.replaceAll('_', ' ')}</div><small className="text-muted">#{item.entity_id ?? '—'} · event #{item.audit_id}</small></td><td><Values value={item.old_values} /></td><td><Values value={item.new_values} /></td>
      </tr>)}</tbody></table></div>}
    </section>
  </>;
}
