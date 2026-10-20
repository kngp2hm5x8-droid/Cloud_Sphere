import { useQuery } from '@tanstack/react-query';
import { Boxes, Cpu, Globe2 } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatting';

interface Plan {
  plan_id: string; name: string; monthly_fee: string; price_per_vcpu_hour: string;
  price_per_gb_ram_hour: string; price_per_gb_storage_month: string; sla_uptime_target_pct: string;
  default_max_vcpu: number; default_max_ram_gb: number; default_max_vms: number;
  is_active: boolean; organization_count: number;
}

interface Region {
  region_id: string; code: string; name: string; country: string | null;
  carbon_intensity_gco2_kwh: string | null;
}

interface Configuration {
  vm_configuration_id: string; name: string | null; vcpu: number; ram_gb: number;
  os_family: string; os_image: string;
}

export default function AdminCatalogPage() {
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: ({ signal }) => getData<Plan[]>('/admin/plans', undefined, signal) });
  const regions = useQuery({ queryKey: ['regions'], queryFn: ({ signal }) => getData<Region[]>('/regions', undefined, signal) });
  const configurations = useQuery({ queryKey: ['configurations'], queryFn: ({ signal }) => getData<Configuration[]>('/configurations', undefined, signal) });

  return <>
    <PageHeader title="Plans, regions, configs" subtitle="Live subscription pricing, regional carbon data, and VM sizes from the CloudSphere catalog." />
    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Subscription plans" value={plans.data ? formatNumber(plans.data.length) : '—'} hint={`${(plans.data ?? []).filter((item) => item.is_active).length} active`} icon={Boxes} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="Active regions" value={regions.data ? formatNumber(regions.data.length) : '—'} hint="Available for resource placement" icon={Globe2} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="VM configurations" value={configurations.data ? formatNumber(configurations.data.length) : '—'} hint="Catalog sizes available for provisioning" icon={Cpu} /></div>
    </div>

    <section className="cs-card cs-card-body cs-table-card mb-3" aria-labelledby="plans-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="plans-heading">Subscription plans</h2><p className="small text-muted mb-0">Pricing, SLA targets, and default quota limits used by database routines.</p></div>{plans.data && <span className="small text-muted">{plans.data.length} records</span>}</div>
      {plans.isPending && <LoadingBlock rows={3} />}
      {plans.isError && <ErrorState error={plans.error} onRetry={() => plans.refetch()} title="Could not load subscription plans" />}
      {plans.data?.length === 0 && <EmptyState title="No subscription plans" description="Subscription plan records will appear here." />}
      {!!plans.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Plan</th><th>Monthly fee</th><th>Usage pricing</th><th>SLA</th><th>Default limits</th><th>Organizations</th><th>Status</th></tr></thead><tbody>{plans.data.map((item) => <tr key={item.plan_id}>
        <td><div className="fw-semibold">{item.name}</div><small className="text-muted">Plan #{item.plan_id}</small></td><td>{formatCurrency(item.monthly_fee)}</td><td><div>${item.price_per_vcpu_hour} / vCPU-hour</div><small className="text-muted">${item.price_per_gb_ram_hour} / RAM GB-hour · ${item.price_per_gb_storage_month} / storage GB-month</small></td><td>{formatPercent(item.sla_uptime_target_pct, 3)}</td><td>{formatNumber(item.default_max_vcpu)} vCPU · {formatNumber(item.default_max_ram_gb)} GB RAM · {formatNumber(item.default_max_vms)} VMs</td><td>{formatNumber(item.organization_count)}</td><td><StatusBadge status={item.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
      </tr>)}</tbody></table></div>}
    </section>

    <section className="cs-card cs-card-body cs-table-card mb-3" aria-labelledby="regions-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="regions-heading">Cloud regions</h2><p className="small text-muted mb-0">Active placement regions and their current versioned carbon profiles.</p></div>{regions.data && <span className="small text-muted">{regions.data.length} records</span>}</div>
      {regions.isPending && <LoadingBlock rows={3} />}
      {regions.isError && <ErrorState error={regions.error} onRetry={() => regions.refetch()} title="Could not load regions" />}
      {regions.data?.length === 0 && <EmptyState title="No active regions" description="Active cloud regions will appear here." />}
      {!!regions.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Region</th><th>Code</th><th>Country</th><th>Carbon intensity</th><th>Status</th></tr></thead><tbody>{regions.data.map((item) => <tr key={item.region_id}>
        <td><div className="fw-semibold">{item.name}</div><small className="text-muted">Region #{item.region_id}</small></td><td><span className="cs-endpoint">{item.code}</span></td><td>{item.country ?? '—'}</td><td>{item.carbon_intensity_gco2_kwh === null ? <span className="text-muted">No current profile</span> : `${formatNumber(item.carbon_intensity_gco2_kwh)} gCO₂/kWh`}</td><td><StatusBadge status="ACTIVE" /></td>
      </tr>)}</tbody></table></div>}
    </section>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="configurations-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="configurations-heading">VM configurations</h2><p className="small text-muted mb-0">Catalog sizes reused by the existing PostgreSQL resource allocator.</p></div>{configurations.data && <span className="small text-muted">{configurations.data.length} records</span>}</div>
      {configurations.isPending && <LoadingBlock rows={3} />}
      {configurations.isError && <ErrorState error={configurations.error} onRetry={() => configurations.refetch()} title="Could not load VM configurations" />}
      {configurations.data?.length === 0 && <EmptyState title="No catalog configurations" description="Provisionable VM configurations will appear here." />}
      {!!configurations.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Configuration</th><th>Compute</th><th>Operating system</th><th>Image</th></tr></thead><tbody>{configurations.data.map((item) => <tr key={item.vm_configuration_id}>
        <td><div className="fw-semibold">{item.name ?? `Configuration ${item.vm_configuration_id}`}</div><small className="text-muted">Configuration #{item.vm_configuration_id}</small></td><td>{formatNumber(item.vcpu)} vCPU · {formatNumber(item.ram_gb)} GB RAM</td><td><StatusBadge status={item.os_family} /></td><td><span className="cs-endpoint">{item.os_image}</span></td>
      </tr>)}</tbody></table></div>}
    </section>
  </>;
}
