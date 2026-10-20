import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import PageHeader from '@/components/common/PageHeader';
import UsageMeter from '@/components/common/UsageMeter';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { useToast } from '@/components/common/ToastProvider';
import { getData, patchData } from '@/lib/api-client';
import { formatNumber } from '@/lib/formatting';

interface Quota {
  quota_id: string; organization_id: string; organization_name: string; project_id: string | null; project_name: string | null;
  max_vcpu: number; used_vcpu: number; max_ram_gb: number; used_ram_gb: number;
  max_vms: number; used_vms: number; max_storage_gb: number | null; used_storage_gb: number;
}

function QuotaRow({ quota }: { quota: Quota }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [vcpu, setVcpu] = useState(String(quota.max_vcpu));
  const [ram, setRam] = useState(String(quota.max_ram_gb));
  const [vms, setVms] = useState(String(quota.max_vms));
  const [storage, setStorage] = useState(quota.max_storage_gb === null ? '' : String(quota.max_storage_gb));
  useEffect(() => {
    setVcpu(String(quota.max_vcpu)); setRam(String(quota.max_ram_gb)); setVms(String(quota.max_vms));
    setStorage(quota.max_storage_gb === null ? '' : String(quota.max_storage_gb));
  }, [quota.max_vcpu,quota.max_ram_gb,quota.max_vms,quota.max_storage_gb]);
  const save = useMutation({
    mutationFn: () => patchData<Quota>(`/quotas/${quota.quota_id}`, {
      max_vcpu: Number(vcpu), max_ram_gb: Number(ram), max_vms: Number(vms),
      max_storage_gb: storage === '' ? null : Number(storage),
    }),
    onSuccess: async () => {
      toast.success(`Quota for ${quota.project_name ?? quota.organization_name} updated.`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin', 'quotas'] }), queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }), queryClient.invalidateQueries({ queryKey: ['projects'] })]);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update quota.'),
  });
  const changed = Number(vcpu) !== quota.max_vcpu || Number(ram) !== quota.max_ram_gb || Number(vms) !== quota.max_vms || (storage === '' ? null : Number(storage)) !== quota.max_storage_gb;

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); save.mutate(); }

  return <tr>
    <td><div className="fw-semibold">{quota.project_name ?? `${quota.organization_name} organization limit`}</div><small className="text-muted">{quota.project_name ? quota.organization_name : 'Organization quota'} · #{quota.quota_id}</small></td>
    <td><UsageMeter label="vCPU" used={quota.used_vcpu} max={quota.max_vcpu} /><UsageMeter label="RAM" used={quota.used_ram_gb} max={quota.max_ram_gb} unit=" GB" /><UsageMeter label="VMs" used={quota.used_vms} max={quota.max_vms} /><div className="mb-2">{quota.max_storage_gb === null ? <div className="d-flex justify-content-between small"><span>Storage</span><span>{formatNumber(quota.used_storage_gb)} GB / Unlimited</span></div> : <UsageMeter label="Storage" used={quota.used_storage_gb} max={quota.max_storage_gb} unit=" GB" />}</div></td>
    <td><form className="d-flex flex-wrap gap-2 align-items-end" onSubmit={submit}>
      <div style={{ width: 85 }}><label className="form-label small mb-1" htmlFor={`quota-cpu-${quota.quota_id}`}>vCPU</label><input className="form-control form-control-sm" id={`quota-cpu-${quota.quota_id}`} type="number" min={quota.used_vcpu} value={vcpu} onChange={(event) => setVcpu(event.target.value)} required /></div>
      <div style={{ width: 85 }}><label className="form-label small mb-1" htmlFor={`quota-ram-${quota.quota_id}`}>RAM GB</label><input className="form-control form-control-sm" id={`quota-ram-${quota.quota_id}`} type="number" min={quota.used_ram_gb} value={ram} onChange={(event) => setRam(event.target.value)} required /></div>
      <div style={{ width: 75 }}><label className="form-label small mb-1" htmlFor={`quota-vms-${quota.quota_id}`}>VMs</label><input className="form-control form-control-sm" id={`quota-vms-${quota.quota_id}`} type="number" min={quota.used_vms} value={vms} onChange={(event) => setVms(event.target.value)} required /></div>
      <div style={{ width: 95 }}><label className="form-label small mb-1" htmlFor={`quota-storage-${quota.quota_id}`}>Storage GB</label><input className="form-control form-control-sm" id={`quota-storage-${quota.quota_id}`} type="number" min={quota.used_storage_gb} value={storage} placeholder="Unlimited" onChange={(event) => setStorage(event.target.value)} /></div>
      <button className="btn btn-outline-primary btn-sm" type="submit" disabled={save.isPending || !changed}>{save.isPending ? 'Saving…' : 'Save limits'}</button>
    </form></td>
  </tr>;
}

export default function AdminQuotasPage() {
  const query = useQuery({ queryKey: ['admin', 'quotas'], queryFn: ({ signal }) => getData<Quota[]>('/quotas', undefined, signal) });
  const quotas = query.data ?? [];

  return <>
    <PageHeader title="Quotas" subtitle="Organization and project limits with live usage maintained by PostgreSQL allocation procedures." />
    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="quotas-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="quotas-heading">Resource quotas</h2><p className="small text-muted mb-0">Limits cannot be lowered below current usage. Leave storage blank to allow unlimited storage.</p></div>{query.data && <span className="small text-muted">{formatNumber(quotas.length)} records</span>}</div>
      {query.isPending && <LoadingBlock rows={5} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load quotas" />}
      {query.data?.length === 0 && <EmptyState title="No quota records" description="Organization and project quota rows will appear here." />}
      {!!query.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Scope</th><th style={{ minWidth: 210 }}>Current usage</th><th style={{ minWidth: 365 }}>Set limits</th></tr></thead><tbody>{quotas.map((quota) => <QuotaRow key={quota.quota_id} quota={quota} />)}</tbody></table></div>}
    </section>
  </>;
}
