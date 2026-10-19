import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowUpRight, Boxes, Cpu, LifeBuoy, Lightbulb, MemoryStick, Receipt, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import UsageMeter from '@/components/common/UsageMeter';
import { ErrorState, FeatureUnavailable, LoadingBlock } from '@/components/common/StateViews';
import { ApiError, getData } from '@/lib/api-client';
import { formatCurrency, formatNumber } from '@/lib/formatting';
import type { AdminDashboardSummary, CustomerDashboardSummary, DashboardSummary } from '@/types/api';

function CustomerView({ s }: { s: CustomerDashboardSummary }) {
  const pendingVms = Math.max(0, s.total_vms - s.running_vms - s.stopped_vms);
  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Total VMs" value={formatNumber(s.total_vms)} hint={`${formatNumber(s.running_vms)} running · ${formatNumber(s.stopped_vms)} stopped · ${formatNumber(pendingVms)} pending`} icon={Server} /></div>
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Allocated vCPU" value={formatNumber(s.allocated_vcpu)} icon={Cpu} /></div>
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Allocated RAM (GB)" value={formatNumber(s.allocated_ram_gb)} icon={MemoryStick} /></div>
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Estimated usage charges" value={formatCurrency(s.estimated_usage_charges)} icon={Receipt} /></div>
      </div>
      <div className="row g-3">
        <div className="col-lg-6">
          <div className="cs-card cs-card-body h-100">
            <h2 className="cs-card-title">Quota utilization</h2>
            {s.quota ? (
              <>
                <UsageMeter label="vCPU" used={s.quota.used_vcpu} max={s.quota.max_vcpu} />
                <UsageMeter label="RAM" used={s.quota.used_ram_gb} max={s.quota.max_ram_gb} unit=" GB" />
                <UsageMeter label="Virtual machines" used={s.quota.used_vms} max={s.quota.max_vms} />
              </>
            ) : (
              <p className="text-muted small mb-0">No quota is configured for your projects yet.</p>
            )}
          </div>
        </div>
        <div className="col-lg-6">
          <div className="row g-3">
            <div className="col-6"><StatCard label="Pending recommendations" value={formatNumber(s.pending_recommendations)} icon={Lightbulb} /></div>
            <div className="col-6"><StatCard label="Open support tickets" value={formatNumber(s.open_tickets)} icon={LifeBuoy} /></div>
          </div>
        </div>
      </div>
    </>
  );
}

function AdminView({ s }: { s: AdminDashboardSummary }) {
  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Hosts" value={formatNumber(s.total_hosts)} hint={`${formatNumber(s.hosts_near_capacity)} near capacity`} icon={Boxes} /></div>
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Virtual machines" value={formatNumber(s.total_vms)} icon={Server} /></div>
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Active organizations" value={formatNumber(s.active_organizations)} icon={Activity} /></div>
        <div className="col-6 col-xl-3"><StatCard className="cs-dashboard-stat" label="Active projects" value={formatNumber(s.active_projects)} hint={`${formatNumber(s.pending_spot_requests)} pending spot requests`} icon={Activity} /></div>
      </div>
      <div className="cs-card cs-card-body">
        <h2 className="cs-card-title">Platform capacity (allocated vs total)</h2>
        <UsageMeter label="vCPU" used={s.allocated_cpu} max={s.total_cpu} />
        <UsageMeter label="RAM" used={s.allocated_ram_gb} max={s.total_ram_gb} unit=" GB" />
      </div>
    </>
  );
}

export default function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: ({ signal }) => getData<DashboardSummary>('/dashboard/summary', undefined, signal),
  });

  return (
    <>
      <PageHeader title="Dashboard" subtitle="A clear view of your CloudSphere environment."
        actions={<Link className="btn btn-primary btn-sm" to="/vms/new">Create VM <ArrowUpRight size={15} className="ms-1" /></Link>} />
      <section className="cs-dashboard-intro" aria-label="Cloud environment overview">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div><h2>Cloud resources, at a glance</h2><p>Review compute allocation, project quotas, and estimated usage in one place.</p></div>
          <Link className="btn btn-sm" to="/vms">View virtual machines <ArrowUpRight size={15} className="ms-1" /></Link>
        </div>
      </section>
      {query.isPending && <LoadingBlock rows={4} />}
      {query.isError &&
        (query.error instanceof ApiError && query.error.isNotImplemented ? (
          <FeatureUnavailable title="Dashboard data is not available yet" description="The backend does not implement the dashboard summary endpoint yet, so no figures are shown." endpoints={['GET /api/v1/dashboard/summary']} />
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load the dashboard" />
        ))}
      {query.isSuccess && (query.data.role === 'admin' ? <AdminView s={query.data} /> : <CustomerView s={query.data} />)}
    </>
  );
}
