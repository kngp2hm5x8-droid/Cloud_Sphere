import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Server, MemoryStick } from 'lucide-react';
import { useState } from 'react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import UsageMeter from '@/components/common/UsageMeter';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { useToast } from '@/components/common/ToastProvider';
import { getData, patchData } from '@/lib/api-client';
import { formatNumber } from '@/lib/formatting';

interface Host {
  host_id: string; hostname: string; region_code: string; region_name: string;
  total_cpu: number; allocated_cpu: number; free_cpu: number;
  total_ram_gb: number; allocated_ram_gb: number; free_ram_gb: number;
  status: string; low_capacity_threshold_pct: number | string;
}

function HostRow({ host }: { host: Host }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(host.status);
  const [threshold, setThreshold] = useState(String(host.low_capacity_threshold_pct));
  const save = useMutation({
    mutationFn: () => patchData<Host>(`/hosts/${host.host_id}/status`, {
      status, low_capacity_threshold_pct: Number(threshold),
    }),
    onSuccess: async () => {
      toast.success(`Host ${host.hostname} updated.`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin', 'hosts'] }), queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update host.'),
  });
  const allocated = host.allocated_cpu > 0 || host.allocated_ram_gb > 0;

  return <tr>
    <td><div className="fw-semibold">{host.hostname}</div><small className="text-muted">Host #{host.host_id}</small></td>
    <td>{host.region_name}<small className="d-block text-muted">{host.region_code}</small></td>
    <td><UsageMeter label="CPU" used={host.allocated_cpu} max={host.total_cpu} unit=" vCPU" /><small className="text-muted">{formatNumber(host.free_cpu)} vCPU free</small></td>
    <td><UsageMeter label="Memory" used={host.allocated_ram_gb} max={host.total_ram_gb} unit=" GB" /><small className="text-muted">{formatNumber(host.free_ram_gb)} GB free</small></td>
    <td><StatusBadge status={host.status} /></td>
    <td><div className="d-flex gap-2 align-items-end" style={{ minWidth: 255 }}>
      <div><label className="form-label small mb-1" htmlFor={`host-status-${host.host_id}`}>Status</label><select className="form-select form-select-sm" id={`host-status-${host.host_id}`} value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Active</option><option value="DRAINING">Draining</option><option value="MAINTENANCE">Maintenance</option><option value="DECOMMISSIONED" disabled={allocated}>Decommissioned</option></select></div>
      <div style={{ width: 94 }}><label className="form-label small mb-1" htmlFor={`host-threshold-${host.host_id}`}>Alert %</label><input className="form-control form-control-sm" id={`host-threshold-${host.host_id}`} type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></div>
      <button className="btn btn-outline-primary btn-sm" type="button" disabled={save.isPending || (status === host.status && Number(threshold) === Number(host.low_capacity_threshold_pct))} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
    </div></td>
  </tr>;
}

export default function AdminHostsPage() {
  const query = useQuery({ queryKey: ['admin', 'hosts'], queryFn: ({ signal }) => getData<Host[]>('/hosts', undefined, signal) });
  const hosts = query.data ?? [];
  const totalCpu = hosts.reduce((sum, host) => sum + host.total_cpu, 0);
  const allocatedCpu = hosts.reduce((sum, host) => sum + host.allocated_cpu, 0);
  const activeHosts = hosts.filter((host) => host.status === 'ACTIVE').length;

  return <>
    <PageHeader title="Hosts & capacity" subtitle="Live host reservations, free capacity, operating status, and low-capacity alert thresholds." />
    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Hosts" value={query.data ? hosts.length : '—'} hint={`${activeHosts} accepting allocations`} icon={Server} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="CPU reserved" value={query.data ? `${formatNumber(allocatedCpu)} / ${formatNumber(totalCpu)} vCPU` : '—'} hint="Capacity counters maintained by database allocation routines" icon={Cpu} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="Memory reserved" value={query.data ? `${formatNumber(hosts.reduce((sum, host) => sum + host.allocated_ram_gb, 0))} / ${formatNumber(hosts.reduce((sum, host) => sum + host.total_ram_gb, 0))} GB` : '—'} hint="Allocated RAM across all hosts" icon={MemoryStick} /></div>
    </div>
    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="hosts-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="hosts-heading">Cloud hosts</h2><p className="small text-muted mb-0">Decommissioning is disabled while a host has allocated VMs.</p></div>{query.data && <span className="small text-muted">{hosts.length} records</span>}</div>
      {query.isPending && <LoadingBlock rows={5} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load hosts" />}
      {query.data?.length === 0 && <EmptyState title="No hosts configured" description="Registered cloud hosts will appear here." />}
      {!!query.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Host</th><th>Region</th><th>CPU capacity</th><th>Memory capacity</th><th>Current status</th><th>Admin controls</th></tr></thead><tbody>{hosts.map((host) => <HostRow key={host.host_id} host={host} />)}</tbody></table></div>}
    </section>
  </>;
}
