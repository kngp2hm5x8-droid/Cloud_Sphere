import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CircleDollarSign, Server } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import { ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { ApiError, getData, postData } from '@/lib/api-client';
import { formatCurrency } from '@/lib/formatting';

interface Project { project_id: string; name: string; status: string; }
interface Region { region_id: string; code: string; name: string; carbon_intensity_gco2_kwh: string | null; }
interface Estimate { hourly_compute_cost: string; monthly_compute_cost: string; monthly_storage_cost: string; monthly_total_cost: string; projected_monthly_after: string; monthly_budget: string | null; within_monthly_budget: boolean; }
interface CreatedVm { vm_id: string; name: string; }
const initial = { project_id: '', name: '', vcpu: 2, ram_gb: 4, storage_gb: 30, os_image: 'ubuntu-22.04', volume_type: 'SSD', region_id: '', max_hourly_budget: '' };

export default function VmCreatePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ['projects'], queryFn: ({ signal }) => getData<Project[]>('/projects', undefined, signal) });
  const regions = useQuery({ queryKey: ['regions'], queryFn: ({ signal }) => getData<Region[]>('/regions', undefined, signal) });
  useEffect(() => {
    if (projects.data?.length) setForm((f) => ({ ...f, project_id: searchParams.get('project_id') || f.project_id || projects.data![0].project_id }));
  }, [projects.data, searchParams]);
  const create = useMutation({ mutationFn: (body: Record<string, unknown>) => postData<CreatedVm>('/vms', body), onSuccess: async (vm) => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['vms'] }), queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
    navigate(`/vms/${vm.vm_id}`);
  }, onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create the VM.') });
  const estimateRequest = async () => {
    setError(null);
    try { setEstimate(await postData<Estimate>('/vms/estimate', { project_id: form.project_id, vcpu: Number(form.vcpu), ram_gb: Number(form.ram_gb), storage_gb: Number(form.storage_gb) })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not estimate cost.'); }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setEstimate(null);
    create.mutate({ project_id: form.project_id, name: form.name.trim(), vcpu: Number(form.vcpu), ram_gb: Number(form.ram_gb), storage_gb: Number(form.storage_gb), os_image: form.os_image, volume_type: form.volume_type,
      region_id: form.region_id || null, max_hourly_budget: form.max_hourly_budget ? Number(form.max_hourly_budget) : null });
  };
  const set = (key: keyof typeof initial, value: string) => setForm((f) => ({ ...f, [key]: value }));
  if (projects.isPending || regions.isPending) return <><PageHeader title="Request a VM" /><LoadingBlock rows={5} /></>;
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => projects.refetch()} title="Could not load project choices" />;
  if (regions.isError) return <ErrorState error={regions.error} onRetry={() => regions.refetch()} title="Could not load regions" />;
  return <>
    <PageHeader title="Request a virtual machine" subtitle="Choose a project and size. PostgreSQL validates quota, budget, and host capacity before the VM is created."
      actions={<Link className="btn btn-outline-primary btn-sm" to="/vms"><ArrowLeft size={15} className="me-1" />All VMs</Link>} />
    {projects.data?.length === 0 && <div className="alert alert-info">You need an active project before requesting a VM. <Link to="/projects">View projects</Link>.</div>}
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    <form className="row g-3" onSubmit={submit}>
      <div className="col-lg-8"><div className="cs-card cs-card-body">
        <h2 className="cs-card-title"><Server size={17} className="me-2" />VM configuration</h2>
        <div className="row g-3">
          <div className="col-md-6"><label className="form-label" htmlFor="project">Project</label><select id="project" className="form-select" required value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>{projects.data?.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}</select></div>
          <div className="col-md-6"><label className="form-label" htmlFor="name">Instance name</label><input id="name" className="form-control" required minLength={1} maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="web-app-01" /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="vcpu">vCPU</label><input id="vcpu" type="number" min={1} max={256} required className="form-control" value={form.vcpu} onChange={(e) => set('vcpu', e.target.value)} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="ram">Memory (GB)</label><input id="ram" type="number" min={1} max={4096} required className="form-control" value={form.ram_gb} onChange={(e) => set('ram_gb', e.target.value)} /></div>
          <div className="col-md-4"><label className="form-label" htmlFor="storage">Root storage (GB)</label><input id="storage" type="number" min={1} max={100000} required className="form-control" value={form.storage_gb} onChange={(e) => set('storage_gb', e.target.value)} /></div>
          <div className="col-md-6"><label className="form-label" htmlFor="os">Operating system image</label><select id="os" className="form-select" value={form.os_image} onChange={(e) => set('os_image', e.target.value)}><option value="ubuntu-22.04">Ubuntu 22.04 LTS</option><option value="debian-12">Debian 12</option><option value="Windows-Server-2022">Windows Server 2022</option></select></div>
          <div className="col-md-6"><label className="form-label" htmlFor="volume">Volume type</label><select id="volume" className="form-select" value={form.volume_type} onChange={(e) => set('volume_type', e.target.value)}><option>SSD</option><option>HDD</option></select></div>
          <div className="col-md-6"><label className="form-label" htmlFor="region">Region</label><select id="region" className="form-select" value={form.region_id} onChange={(e) => set('region_id', e.target.value)}><option value="">Automatic (lowest carbon with capacity)</option>{regions.data?.map((r) => <option key={r.region_id} value={r.region_id}>{r.name} · {r.code}</option>)}</select></div>
          <div className="col-md-6"><label className="form-label" htmlFor="hourly">Maximum hourly compute budget (optional)</label><div className="input-group"><span className="input-group-text">$</span><input id="hourly" type="number" min={0} step="0.0001" className="form-control" value={form.max_hourly_budget} onChange={(e) => set('max_hourly_budget', e.target.value)} placeholder="No cap" /></div></div>
        </div>
      </div></div>
      <div className="col-lg-4"><div className="cs-card cs-card-body">
        <h2 className="cs-card-title"><CircleDollarSign size={17} className="me-2" />Cost estimate</h2>
        <p className="small text-muted">Preview the plan price and monthly budget projection before provisioning.</p>
        {estimate && <div className={`alert ${estimate.within_monthly_budget ? 'alert-success' : 'alert-warning'} py-2 small`}>
          <div className="d-flex justify-content-between"><span>Compute / month</span><strong>{formatCurrency(estimate.monthly_compute_cost)}</strong></div>
          <div className="d-flex justify-content-between mt-1"><span>Storage / month</span><strong>{formatCurrency(estimate.monthly_storage_cost)}</strong></div>
          <div className="d-flex justify-content-between mt-1"><span>Projected total</span><strong>{formatCurrency(estimate.projected_monthly_after)}</strong></div>
          <div className="mt-2">{estimate.within_monthly_budget ? <><Check size={14} className="me-1" />Within project budget</> : 'This request exceeds the project budget.'}</div>
        </div>}
        <button type="button" onClick={estimateRequest} className="btn btn-outline-primary w-100 mb-2" disabled={!form.project_id}>Estimate cost</button>
        <button type="submit" className="btn btn-primary w-100" disabled={!form.project_id || !form.name.trim() || create.isPending}>{create.isPending ? 'Provisioning…' : 'Create virtual machine'}</button>
        <p className="small text-muted mt-3 mb-0">VM creation is validated transactionally against project quota, organization quota, budget, and host capacity.</p>
      </div></div>
    </form>
  </>;
}
