import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Server } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { ErrorState, LoadingBlock } from '@/components/common/StateViews';
import StatusBadge from '@/components/common/StatusBadge';
import UsageMeter from '@/components/common/UsageMeter';
import { getData } from '@/lib/api-client';
import { formatCurrency, formatDateTime } from '@/lib/formatting';

interface Project { project_id: string; name: string; description: string | null; status: string; monthly_budget: string | null; max_vcpu: number; used_vcpu: number; max_ram_gb: number; used_ram_gb: number; max_vms: number; used_vms: number; }
interface Vm { vm_id: string; name: string; state: string; vcpu: number; ram_gb: number; os_image: string; region_code: string | null; created_at: string; }

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const project = useQuery({ queryKey: ['project', projectId], queryFn: ({ signal }) => getData<Project>(`/projects/${projectId}`, undefined, signal) });
  const vms = useQuery({ queryKey: ['vms', projectId], queryFn: ({ signal }) => getData<Vm[]>('/vms', { project_id: projectId }, signal), enabled: !!projectId });
  return <>
    <PageHeader title={project.data?.name ?? 'Project'} subtitle={project.data?.description ?? 'Project resources and quota usage.'}
      actions={<Link className="btn btn-primary btn-sm" to={`/vms/new?project_id=${projectId}`}><Plus size={15} className="me-1" />Create VM</Link>} />
    {project.isPending && <LoadingBlock rows={3} />}
    {project.isError && <ErrorState error={project.error} onRetry={() => project.refetch()} title="Could not load project" />}
    {project.data && <>
      <div className="cs-card cs-card-body mb-3">
        <div className="d-flex flex-wrap justify-content-between gap-3 mb-3"><span className="cs-badge cs-badge--success">{project.data.status}</span>
          <span className="small text-muted">Monthly budget: <strong className="text-body">{project.data.monthly_budget ? formatCurrency(project.data.monthly_budget) : 'No limit'}</strong></span></div>
        <div className="row g-4">
          <div className="col-md-4"><UsageMeter label="vCPU" used={project.data.used_vcpu} max={project.data.max_vcpu} /></div>
          <div className="col-md-4"><UsageMeter label="RAM" used={project.data.used_ram_gb} max={project.data.max_ram_gb} unit=" GB" /></div>
          <div className="col-md-4"><UsageMeter label="VM slots" used={project.data.used_vms} max={project.data.max_vms} /></div>
        </div>
      </div>
      <div className="cs-card cs-card-body">
        <h2 className="cs-card-title"><Server size={17} className="me-2" />Virtual machines</h2>
        {vms.isPending && <LoadingBlock rows={3} />}
        {vms.isError && <ErrorState error={vms.error} onRetry={() => vms.refetch()} title="Could not load project VMs" />}
        {vms.data && !vms.data.length && <p className="text-muted mb-0">No VMs in this project yet.</p>}
        {vms.data && !!vms.data.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Name</th><th>Configuration</th><th>Region</th><th>Status</th><th>Created</th></tr></thead><tbody>
          {vms.data.map((vm) => <tr key={vm.vm_id}><td><Link to={`/vms/${vm.vm_id}`} className="fw-semibold">{vm.name}</Link></td><td>{vm.vcpu} vCPU · {vm.ram_gb} GB</td><td>{vm.region_code ?? '—'}</td><td><StatusBadge status={vm.state} /></td><td>{formatDateTime(vm.created_at)}</td></tr>)}
        </tbody></table></div>}
      </div>
    </>}
  </>;
}
