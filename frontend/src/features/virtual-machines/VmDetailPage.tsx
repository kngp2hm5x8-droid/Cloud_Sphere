import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Cpu, MemoryStick } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import MetricsChart, { type MetricPoint } from '@/components/common/MetricsChart';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import StatusBadge from '@/components/common/StatusBadge';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/ToastProvider';
import { ApiError, getData, postData } from '@/lib/api-client';
import { formatDateTime } from '@/lib/formatting';

interface Vm { vm_id: string; project_id: string; project_name: string; name: string; state: string; vcpu: number; ram_gb: number; os_image: string; region_code: string | null; region_name: string | null; hostname: string | null; private_ip: string | null; requested_at: string; started_at: string | null; stopped_at: string | null; terminated_at: string | null; created_at: string; }
export default function VmDetailPage() {
  const { vmId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const vm = useQuery({ queryKey: ['vm', vmId], queryFn: ({ signal }) => getData<Vm>(`/vms/${vmId}`, undefined, signal) });
  const metrics = useQuery({ queryKey: ['metrics', vmId], queryFn: ({ signal }) => getData<MetricPoint[]>(`/vms/${vmId}/metrics`, undefined, signal) });
  const action = useMutation({ mutationFn: (verb: string) => postData(`/vms/${vmId}/${verb}`), onSuccess: async (_, verb) => {
    setConfirmTerminate(false);
    const pastTense = { start: 'started', stop: 'stopped', terminate: 'terminated' }[verb] ?? verb;
    toast.success(`Virtual machine ${pastTense} successfully.`);
    await Promise.all([qc.invalidateQueries({ queryKey: ['vm', vmId] }), qc.invalidateQueries({ queryKey: ['vms'] }), qc.invalidateQueries({ queryKey: ['metrics', vmId] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['monitoring-summary'] })]);
  } });
  const allowed: string[] = vm.data?.state === 'RUNNING' ? ['stop', 'terminate'] : vm.data?.state === 'STOPPED' ? ['start', 'terminate'] : vm.data && !['TERMINATED','FAILED','PREEMPTED'].includes(vm.data.state) ? ['terminate'] : [];
  return <>
    <PageHeader title={vm.data?.name ?? 'Virtual machine'} subtitle={vm.data ? `${vm.data.project_name} · ${vm.data.region_name ?? 'Region unavailable'}` : 'Instance details and recent monitoring.'}
      actions={<Link className="btn btn-outline-primary btn-sm" to="/vms"><ArrowLeft size={15} className="me-1" />All VMs</Link>} />
    {vm.isPending && <LoadingBlock rows={4} />}
    {vm.isError && <ErrorState error={vm.error} onRetry={() => vm.refetch()} title="Could not load this VM" />}
    {action.isError && <div className="alert alert-danger">{action.error instanceof ApiError ? action.error.message : 'VM action failed.'}</div>}
    {vm.data && <>
      <div className="row g-3 mb-3">
        <div className="col-lg-8"><div className="cs-card cs-card-body h-100">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-3"><div><div className="d-flex align-items-center gap-2 mb-2"><StatusBadge status={vm.data.state} /><span className="small text-muted">ID {vm.data.vm_id}</span></div><h2 className="h5 mb-1">{vm.data.os_image}</h2><p className="text-muted small mb-0">{vm.data.hostname ?? 'Host pending'}{vm.data.private_ip ? ` · ${vm.data.private_ip}` : ''}</p></div>
            <div className="d-flex gap-2">{allowed.map((verb) => <button key={verb} className={`btn btn-sm ${verb === 'terminate' ? 'btn-outline-danger' : 'btn-outline-primary'}`} disabled={action.isPending} onClick={() => verb === 'terminate' ? setConfirmTerminate(true) : action.mutate(verb)}>{verb[0].toUpperCase() + verb.slice(1)}</button>)}</div></div>
          <hr /><div className="row g-3"><div className="col-sm-3"><div className="small text-muted"><Cpu size={14} className="me-1" />vCPU</div><strong>{vm.data.vcpu}</strong></div><div className="col-sm-3"><div className="small text-muted"><MemoryStick size={14} className="me-1" />Memory</div><strong>{vm.data.ram_gb} GB</strong></div><div className="col-sm-3"><div className="small text-muted">Region</div><strong>{vm.data.region_code ?? '—'}</strong></div><div className="col-sm-3"><div className="small text-muted">Created</div><strong className="small">{formatDateTime(vm.data.created_at)}</strong></div></div>
        </div></div>
        <div className="col-lg-4"><div className="cs-card cs-card-body h-100"><h2 className="cs-card-title">Lifecycle</h2><dl className="row small mb-0"><dt className="col-5">Requested</dt><dd className="col-7">{formatDateTime(vm.data.requested_at)}</dd><dt className="col-5">Started</dt><dd className="col-7">{formatDateTime(vm.data.started_at)}</dd><dt className="col-5">Stopped</dt><dd className="col-7">{formatDateTime(vm.data.stopped_at)}</dd><dt className="col-5">Terminated</dt><dd className="col-7">{formatDateTime(vm.data.terminated_at)}</dd></dl></div></div>
      </div>
      <div className="cs-card cs-card-body"><h2 className="cs-card-title">Monitoring · last 24 hours</h2>
        {metrics.isPending && <LoadingBlock rows={4} />}{metrics.isError && <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} title="Could not load monitoring samples" />}
        {metrics.data && !metrics.data.length && <EmptyState title="No samples in the last 24 hours" description="Monitoring samples will appear here when this VM has recent activity." />}
        {!!metrics.data?.length && <MetricsChart data={metrics.data} />}
      </div>
    </>}
    <ConfirmDialog
      open={confirmTerminate}
      title="Terminate this virtual machine?"
      description={<>This action releases the VM’s reserved resources and cannot be undone. The VM record will remain available in the project history.</>}
      confirmLabel="Terminate VM"
      busy={action.isPending}
      onCancel={() => setConfirmTerminate(false)}
      onConfirm={() => action.mutate('terminate')}
    />
  </>;
}
