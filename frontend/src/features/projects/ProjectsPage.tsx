import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatCurrency, formatNumber } from '@/lib/formatting';

interface Project {
  project_id: string; name: string; description: string | null; status: string; monthly_budget: string | null;
  max_vcpu: number | null; used_vcpu: number | null; max_ram_gb: number | null; used_ram_gb: number | null;
  max_vms: number | null; used_vms: number | null;
}

export default function ProjectsPage() {
  const query = useQuery({ queryKey: ['projects'], queryFn: ({ signal }) => getData<Project[]>('/projects', undefined, signal) });
  return <>
    <PageHeader title="Projects" subtitle="Your organization’s projects, quotas, and VM resources."
      actions={<Link className="btn btn-primary btn-sm" to="/vms/new"><Plus size={15} className="me-1" />Request a VM</Link>} />
    {query.isPending && <LoadingBlock rows={4} />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load projects" />}
    {query.isSuccess && query.data.length === 0 && <EmptyState title="No projects yet" description="Create a project to start requesting virtual machines." />}
    {query.isSuccess && query.data.length > 0 && <div className="row g-3">
      {query.data.map((project) => <div className="col-md-6 col-xl-4" key={project.project_id}>
        <Link to={`/projects/${project.project_id}`} className="cs-card cs-card-body h-100 d-block text-decoration-none text-reset">
          <div className="d-flex align-items-start gap-3"><span className="cs-stat-icon"><FolderKanban size={18} /></span><div className="min-w-0">
            <h2 className="h6 mb-1">{project.name}</h2><p className="small text-muted mb-2">{project.description || 'Project resource workspace'}</p>
            <span className="cs-badge cs-badge--neutral">{project.status}</span>
          </div></div>
          <hr />
          <div className="d-flex justify-content-between small"><span className="text-muted">vCPU</span><strong>{formatNumber(project.used_vcpu)}/{formatNumber(project.max_vcpu)}</strong></div>
          <div className="d-flex justify-content-between small mt-2"><span className="text-muted">VM slots</span><strong>{formatNumber(project.used_vms)}/{formatNumber(project.max_vms)}</strong></div>
          <div className="d-flex justify-content-between small mt-2"><span className="text-muted">Monthly budget</span><strong>{project.monthly_budget ? formatCurrency(project.monthly_budget) : 'No limit'}</strong></div>
        </Link>
      </div>)}
    </div>}
  </>;
}
