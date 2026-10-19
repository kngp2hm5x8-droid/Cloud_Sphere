import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CircleDollarSign, Clock3, Plus, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { useToast } from '@/components/common/ToastProvider';
import { formatDateTime } from '@/lib/formatting';
import { getData, postData } from '@/lib/api-client';

interface SpotRequest {
  bid_id: string; project_id: string; project_name: string; vm_configuration_id: string;
  configuration_name: string | null; vcpu: number; ram_gb: number; os_family: string;
  region_id: string | null; region_code: string | null; region_name: string | null;
  max_price_per_hour: number | string; status: string; fulfilled_vm_id: string | null;
  fulfilled_vm_name: string | null; fulfilled_price_per_hour: number | string | null;
  expires_at: string | null; fulfilled_at: string | null; preempted_at: string | null; created_at: string;
}
interface Project { project_id: string; name: string; status: string }
interface Configuration { vm_configuration_id: string; name: string | null; vcpu: number; ram_gb: number; os_family: string }
interface Region { region_id: string; code: string; name: string }

const formatHourlyPrice = (value: number | string) => new Intl.NumberFormat(undefined, {
  style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4,
}).format(Number(value));

export default function SpotMarketPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [configurationId, setConfigurationId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const requests = useQuery({ queryKey: ['spot-requests'], queryFn: ({ signal }) => getData<SpotRequest[]>('/spot-requests', undefined, signal) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: ({ signal }) => getData<Project[]>('/projects', undefined, signal) });
  const configurations = useQuery({ queryKey: ['configurations'], queryFn: ({ signal }) => getData<Configuration[]>('/configurations', undefined, signal) });
  const regions = useQuery({ queryKey: ['regions'], queryFn: ({ signal }) => getData<Region[]>('/regions', undefined, signal) });
  const create = useMutation({
    mutationFn: () => postData<SpotRequest>('/spot-requests', {
      project_id: projectId, vm_configuration_id: configurationId,
      region_id: regionId || null, max_price_per_hour: Number(maxPrice),
    }),
    onSuccess: async () => {
      toast.success('Spot bid request created. It will not provision a VM automatically.');
      setMaxPrice('');
      await queryClient.invalidateQueries({ queryKey: ['spot-requests'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not create spot request.'),
  });
  const items = requests.data ?? [];
  const openCount = items.filter((item) => item.status === 'OPEN').length;
  const fulfilledCount = items.filter((item) => item.status === 'FULFILLED').length;
  const activeProjects = (projects.data ?? []).filter((project) => project.status === 'ACTIVE');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return <>
    <PageHeader title="Spot market" subtitle="Review persisted preemptible VM bids and submit a price request for an active project." />

    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Bid requests" value={requests.data ? items.length : '—'} hint="Requests visible to your organization" icon={Zap} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="Open bids" value={requests.data ? openCount : '—'} hint="Awaiting a separate fulfillment action" icon={Clock3} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="Fulfilled" value={requests.data ? fulfilledCount : '—'} hint="Linked to an existing VM" icon={ArrowDownToLine} /></div>
    </div>

    <section className="cs-card cs-card-body mb-3" aria-labelledby="spot-create-heading">
      <div className="d-flex align-items-start gap-2 mb-3"><CircleDollarSign size={20} className="text-primary mt-1" /><div><h2 className="cs-card-title mb-1" id="spot-create-heading">Create a bid request</h2><p className="small text-muted mb-0">Choose a project, catalog size, optional region, and maximum hourly price.</p></div></div>
      {(projects.isError || configurations.isError || regions.isError) && <ErrorState error={projects.error ?? configurations.error ?? regions.error} onRetry={() => { void projects.refetch(); void configurations.refetch(); void regions.refetch(); }} title="Could not load spot request options" />}
      {projects.isPending || configurations.isPending || regions.isPending ? <LoadingBlock rows={2} /> : <form className="row g-3 align-items-end" onSubmit={submit}>
        <div className="col-md-6 col-xl-3"><label className="form-label" htmlFor="spot-project">Project</label><select className="form-select" id="spot-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} required><option value="">Select a project</option>{activeProjects.map((item) => <option key={item.project_id} value={item.project_id}>{item.name}</option>)}</select></div>
        <div className="col-md-6 col-xl-3"><label className="form-label" htmlFor="spot-size">VM configuration</label><select className="form-select" id="spot-size" value={configurationId} onChange={(event) => setConfigurationId(event.target.value)} required><option value="">Select a size</option>{(configurations.data ?? []).map((item) => <option key={item.vm_configuration_id} value={item.vm_configuration_id}>{item.name ?? `${item.vcpu} vCPU`} · {item.vcpu} vCPU / {item.ram_gb} GB · {item.os_family}</option>)}</select></div>
        <div className="col-md-6 col-xl-2"><label className="form-label" htmlFor="spot-region">Region</label><select className="form-select" id="spot-region" value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">Any region</option>{(regions.data ?? []).map((item) => <option key={item.region_id} value={item.region_id}>{item.name} ({item.code})</option>)}</select></div>
        <div className="col-md-6 col-xl-2"><label className="form-label" htmlFor="spot-price">Max price / hour ($)</label><input className="form-control" id="spot-price" type="number" min="0.0001" max="99999999.9999" step="0.0001" inputMode="decimal" placeholder="0.0250" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} required /></div>
        <div className="col-xl-2"><button className="btn btn-primary w-100" type="submit" disabled={create.isPending || activeProjects.length === 0 || (configurations.data?.length ?? 0) === 0}><Plus size={16} className="me-1" />{create.isPending ? 'Submitting…' : 'Submit bid'}</button></div>
        {activeProjects.length === 0 && <div className="col-12 small text-muted">No active projects are available for spot requests.</div>}
      </form>}
    </section>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="spot-requests-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="spot-requests-heading">Spot bid history</h2><p className="small text-muted mb-0">Only database records are shown. Open bids are not automatically matched or provisioned.</p></div>{requests.data && <span className="small text-muted">{items.length} records</span>}</div>
      {requests.isPending && <LoadingBlock rows={4} />}
      {requests.isError && <ErrorState error={requests.error} onRetry={() => requests.refetch()} title="Could not load spot requests" />}
      {requests.data?.length === 0 && <EmptyState title="No spot requests yet" description="Create a bid request above. It will remain open until a separate fulfillment process updates it." />}
      {!!requests.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>Request</th><th>Project</th><th>Configuration</th><th>Region</th><th>Price / hour</th><th>Outcome</th><th>Created</th></tr></thead><tbody>{items.map((item) => <tr key={item.bid_id}>
        <td><div className="fw-semibold">Bid #{item.bid_id}</div><StatusBadge status={item.status} />{item.expires_at && <div className="small text-muted mt-1">Expires {formatDateTime(item.expires_at)}</div>}</td>
        <td>{item.project_name}</td>
        <td><div className="fw-semibold">{item.configuration_name ?? `Configuration ${item.vm_configuration_id}`}</div><small className="text-muted">{item.vcpu} vCPU · {item.ram_gb} GB RAM · {item.os_family}</small></td>
        <td>{item.region_name ? <>{item.region_name}<small className="d-block text-muted">{item.region_code}</small></> : <span className="text-muted">Any region</span>}</td>
        <td><div className="fw-semibold">{formatHourlyPrice(item.max_price_per_hour)}</div><small className="text-muted">maximum bid</small>{item.fulfilled_price_per_hour !== null && <div className="small mt-1">Filled at {formatHourlyPrice(item.fulfilled_price_per_hour)}</div>}</td>
        <td>{item.fulfilled_vm_id ? <><div className="fw-semibold">{item.fulfilled_vm_name ?? `VM #${item.fulfilled_vm_id}`}</div><small className="text-muted">VM #{item.fulfilled_vm_id}{item.fulfilled_at ? ` · ${formatDateTime(item.fulfilled_at)}` : ''}</small></> : item.preempted_at ? <span className="text-muted">Preempted {formatDateTime(item.preempted_at)}</span> : <span className="text-muted">No fulfillment recorded</span>}</td>
        <td className="text-nowrap">{formatDateTime(item.created_at)}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </>;
}
