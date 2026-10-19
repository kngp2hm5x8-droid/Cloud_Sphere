import { useQuery } from '@tanstack/react-query';
import { Clock3, Lightbulb, Server } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from '@/lib/formatting';

type TriggerMetrics = Record<string, number | string | boolean | null>;
interface Recommendation {
  recommendation_id: string; vm_id: string; vm_name: string; project_id: string; project_name: string;
  recommendation_type: string; rule_code: string; trigger_metrics: TriggerMetrics;
  window_start: string; window_end: string; recommended_vm_configuration_id: string | null;
  recommended_configuration_name: string | null;
  recommended_vcpu: number | null; recommended_ram_gb: number | null;
  estimated_monthly_saving: number | string | null; status: string; created_at: string;
}

const METRIC_LABELS: Record<string, string> = {
  avg_cpu_pct: 'Average CPU', p95_cpu_pct: '95th percentile CPU', max_cpu_pct: 'Peak CPU',
  samples: 'Samples', avg_memory_pct: 'Average memory', max_memory_pct: 'Peak memory',
};

function formatMetric(key: string, value: number | string | boolean | null) {
  if (value === null || typeof value === 'boolean') return String(value ?? '—');
  if (key === 'samples') return formatNumber(value);
  if (key.endsWith('_pct')) return formatPercent(value, 2);
  return typeof value === 'number' ? formatNumber(value, 2) : value;
}

function TriggerEvidence({ metrics }: { metrics: TriggerMetrics }) {
  const entries = Object.entries(metrics).filter(([key]) => METRIC_LABELS[key]);
  if (!entries.length) return <span className="text-muted">No trigger metrics recorded</span>;
  return <div className="d-flex flex-wrap gap-2">{entries.map(([key, value]) => <span className="cs-badge cs-badge--neutral" key={key}>
    {METRIC_LABELS[key]}: {formatMetric(key, value)}
  </span>)}</div>;
}

export default function RecommendationsPage() {
  const query = useQuery({ queryKey: ['recommendations'], queryFn: ({ signal }) => getData<Recommendation[]>('/recommendations', undefined, signal) });
  const recommendations = query.data ?? [];
  const pending = recommendations.filter((item) => item.status === 'PENDING');
  const affectedVmCount = new Set(recommendations.map((item) => item.vm_id)).size;

  return <>
    <PageHeader title="Recommendations" subtitle="Rule-based recommendations recorded from VM monitoring data. These records do not change VM configuration or lifecycle state." />

    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Recommendations" value={query.data ? formatNumber(recommendations.length) : '—'} hint="All recorded statuses" icon={Lightbulb} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="Pending review" value={query.data ? formatNumber(pending.length) : '—'} hint="Recommendations awaiting a decision" icon={Clock3} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="VMs covered" value={query.data ? formatNumber(affectedVmCount) : '—'} hint="Unique VMs with a recommendation record" icon={Server} /></div>
    </div>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="recommendations-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="recommendations-heading">Recommendation history</h2><p className="small text-muted mb-0">Evidence and suggested configuration are read from persisted rule results.</p></div>{query.data && <span className="small text-muted">{recommendations.length} records</span>}</div>
      {query.isPending && <LoadingBlock rows={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load recommendations" />}
      {query.data?.length === 0 && <EmptyState title="No recommendations yet" description="Rule results will appear here when recommendation records exist for your organization's VMs." />}
      {!!query.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>Recommendation</th><th>VM / project</th><th>Recorded evidence</th><th>Suggested configuration</th><th>Monthly estimate</th><th>Window / status</th></tr></thead><tbody>
        {recommendations.map((item) => <tr key={item.recommendation_id}>
          <td><StatusBadge status={item.recommendation_type} /><div className="small text-muted mt-1">{item.rule_code}</div></td>
          <td><div className="fw-semibold">{item.vm_name}</div><small className="text-muted">{item.project_name}</small></td>
          <td><TriggerEvidence metrics={item.trigger_metrics} /></td>
          <td>{item.recommended_vm_configuration_id
            ? <><div className="fw-semibold">{item.recommended_configuration_name ?? `Configuration ${item.recommended_vm_configuration_id}`}</div><small className="text-muted">{formatNumber(item.recommended_vcpu)} vCPU · {formatNumber(item.recommended_ram_gb)} GB RAM</small></>
            : <span className="text-muted">No configuration specified</span>}</td>
          <td>{item.estimated_monthly_saving !== null
            ? <><div className="fw-semibold">{formatCurrency(item.estimated_monthly_saving)}</div><small className="text-muted">estimated monthly saving</small></>
            : <span className="text-muted">No estimate recorded</span>}</td>
          <td className="text-nowrap"><div>{formatDateTime(item.window_start)}</div><small className="text-muted">to {formatDateTime(item.window_end)}</small><div className="mt-2"><StatusBadge status={item.status} /></div></td>
        </tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
