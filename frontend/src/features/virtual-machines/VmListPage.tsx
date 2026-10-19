import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Server } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import StatusBadge from '@/components/common/StatusBadge';
import { ApiError, getData, postData } from '@/lib/api-client';
import { formatDateTime } from '@/lib/formatting';

interface Vm { vm_id: string; project_id: string; project_name: string; name: string; state: string; vcpu: number; ram_gb: number; os_image: string; region_code: string | null; created_at: string; }
export default function VmListPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['vms'], queryFn: ({ signal }) => getData<Vm[]>('/vms', undefined, signal) });
  const action = useMutation({ mutationFn: ({ id, verb }: { id: string; verb: string }) => postData(`/vms/${id}/${verb}`), onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['vms'] }), qc.invalidateQueries({ queryKey: ['storage'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['project'] }), qc.invalidateQueries({ queryKey: ['monitoring-summary'] })]) });
  return <>
    <PageHeader title="Virtual machines" subtitle="VMs and lifecycle actions for projects you can access."
      actions={<Link className="btn btn-primary btn-sm" to="/vms/new"><Plus size={15} className="me-1" />Create VM</Link>} />
    {action.isError && <div className="alert alert-danger" role="alert">{action.error instanceof ApiError ? action.error.message : 'VM action failed.'}</div>}
    {query.isPending && <LoadingBlock rows={5} />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load virtual machines" />}
    {query.data?.length === 0 && <EmptyState title="No virtual machines yet" description="Create a VM to see it here." action={<Link className="btn btn-primary btn-sm" to="/vms/new">Create VM</Link>} />}
    {!!query.data?.length && <div className="cs-card cs-card-body cs-table-card"><div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Name</th><th>Project</th><th>Configuration</th><th>Region</th><th>Status</th><th>Created</th><th aria-label="Actions" /></tr></thead><tbody>
      {query.data.map((vm) => <tr key={vm.vm_id}><td><Link to={`/vms/${vm.vm_id}`} className="fw-semibold"><Server size={15} className="me-2" />{vm.name}</Link></td><td><Link to={`/projects/${vm.project_id}`}>{vm.project_name}</Link></td><td>{vm.vcpu} vCPU · {vm.ram_gb} GB<br /><small className="text-muted">{vm.os_image}</small></td><td>{vm.region_code ?? '—'}</td><td><StatusBadge status={vm.state} /></td><td>{formatDateTime(vm.created_at)}</td><td className="text-end text-nowrap">
        {vm.state === 'RUNNING' && <button className="btn btn-sm btn-outline-secondary" onClick={() => action.mutate({ id: vm.vm_id, verb: 'stop' })} disabled={action.isPending}>Stop</button>}
        {vm.state === 'STOPPED' && <button className="btn btn-sm btn-outline-primary me-1" onClick={() => action.mutate({ id: vm.vm_id, verb: 'start' })} disabled={action.isPending}>Start</button>}
        {!['TERMINATED','FAILED','PREEMPTED'].includes(vm.state) && <button className="btn btn-sm btn-outline-danger ms-1" onClick={() => action.mutate({ id: vm.vm_id, verb: 'terminate' })} disabled={action.isPending}>Terminate</button>}
      </td></tr>)}
    </tbody></table></div></div>}
  </>;
}
