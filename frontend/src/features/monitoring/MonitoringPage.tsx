import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/formatting';

interface Summary { vm_id: string; name: string; state: string; avg_cpu_pct: string | null; avg_ram_pct: string | null; max_cpu_pct: string | null; max_ram_pct: string | null; avg_disk_pct: string | null; sample_count: number; latest_sample_at: string | null; }
export default function MonitoringPage() {
  const query = useQuery({ queryKey: ['monitoring-summary'], queryFn: ({ signal }) => getData<Summary[]>('/monitoring/summary', undefined, signal) });
  return <>
    <PageHeader title="Monitoring" subtitle="Recent CPU, memory, and disk measurements from PostgreSQL."
      actions={<span className="small text-muted align-self-center"><Activity size={15} className="me-1" />24 hour window</span>} />
    {query.isPending && <LoadingBlock rows={5} />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load monitoring summary" />}
    {query.data && !query.data.length && <EmptyState title="No monitoring data yet" description="There are no VMs or samples in the current account." />}
    {!!query.data?.length && <div className="cs-card cs-card-body cs-table-card"><div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Virtual machine</th><th>CPU avg / peak</th><th>Memory avg / peak</th><th>Disk avg</th><th>Samples</th><th>Latest sample</th></tr></thead><tbody>
      {query.data.map((vm) => <tr key={vm.vm_id}><td><Link to={`/vms/${vm.vm_id}`} className="fw-semibold">{vm.name}</Link><div className="small text-muted">{vm.state}</div></td><td>{vm.avg_cpu_pct == null ? '—' : `${formatNumber(vm.avg_cpu_pct, 1)}% / ${formatNumber(vm.max_cpu_pct, 1)}%`}</td><td>{vm.avg_ram_pct == null ? '—' : `${formatNumber(vm.avg_ram_pct, 1)}% / ${formatNumber(vm.max_ram_pct, 1)}%`}</td><td>{vm.avg_disk_pct == null ? '—' : `${formatNumber(vm.avg_disk_pct, 1)}%`}</td><td>{formatNumber(vm.sample_count)}</td><td>{formatDateTime(vm.latest_sample_at)}</td></tr>)}
    </tbody></table></div><p className="small text-muted mt-3 mb-0">Select a VM to view its recent metric chart.</p></div>}
  </>;
}
