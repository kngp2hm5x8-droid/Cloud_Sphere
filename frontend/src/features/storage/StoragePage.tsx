import { useQuery } from '@tanstack/react-query';
import { Camera, HardDrive, Layers3 } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import UsageMeter from '@/components/common/UsageMeter';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/formatting';

interface Volume {
  volume_id: string; project_id: string; project_name: string; region_code: string; vm_id: string | null;
  vm_name: string | null; name: string; size_gb: number; used_gb: number | string; volume_type: string;
  is_root: boolean; state: string; created_at: string;
}
interface Snapshot {
  snapshot_id: string; volume_id: string; project_id: string; project_name: string; volume_name: string;
  vm_name: string | null; name: string; status: string; size_gb: number | string | null;
  taken_at: string; retention_days: number; expires_at: string; created_at: string;
}
interface ProjectStorage { project_id: string; name: string; used_storage_gb: number | null; max_storage_gb: number | null; }

const gigabytes = (value: number | string | null | undefined) => formatNumber(value, 2);

export default function StoragePage() {
  const volumes = useQuery({ queryKey: ['storage', 'volumes'], queryFn: ({ signal }) => getData<Volume[]>('/volumes', undefined, signal) });
  const snapshots = useQuery({ queryKey: ['storage', 'snapshots'], queryFn: ({ signal }) => getData<Snapshot[]>('/snapshots', undefined, signal) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: ({ signal }) => getData<ProjectStorage[]>('/projects', undefined, signal) });
  const rows = volumes.data ?? [];
  const provisionedGb = rows.reduce((sum, volume) => sum + volume.size_gb, 0);
  const usedGb = rows.reduce((sum, volume) => sum + Number(volume.used_gb), 0);

  return <>
    <PageHeader title="Storage & snapshots" subtitle="Project volumes, attachment state, capacity use, and saved snapshots." />

    {volumes.isPending ? <LoadingBlock rows={2} /> : volumes.isError ? <ErrorState error={volumes.error} onRetry={() => volumes.refetch()} title="Could not load storage volumes" /> : <>
      <div className="row g-3 mb-3">
        <div className="col-sm-6 col-xl-4"><StatCard label="Active volumes" value={rows.length} icon={HardDrive} /></div>
        <div className="col-sm-6 col-xl-4"><StatCard label="Provisioned capacity" value={<>{gigabytes(provisionedGb)} <small className="fs-6 fw-semibold">GB</small></>} hint="Non-deleted volumes" icon={Layers3} /></div>
        <div className="col-sm-6 col-xl-4"><StatCard label="Reported usage" value={<>{gigabytes(usedGb)} <small className="fs-6 fw-semibold">GB</small></>} hint="Database-reported volume usage" icon={HardDrive} /></div>
      </div>

      {projects.isError && <ErrorState error={projects.error} onRetry={() => projects.refetch()} title="Could not load storage quotas" />}
      {projects.isPending && <LoadingBlock rows={2} />}
      {projects.data?.length ? <section className="cs-card cs-card-body mb-3" aria-labelledby="storage-quota-heading">
        <h2 className="cs-card-title" id="storage-quota-heading">Project storage quotas</h2>
        <div className="row g-3">
          {projects.data.filter((project) => project.max_storage_gb !== null).map((project) => <div className="col-md-6 col-xl-4" key={project.project_id}>
            <div className="cs-storage-quota"><div className="fw-semibold small mb-2">{project.name}</div>
              <UsageMeter label="Storage" used={project.used_storage_gb ?? 0} max={project.max_storage_gb!} unit=" GB" />
            </div>
          </div>)}
          {projects.data.filter((project) => project.max_storage_gb === null).map((project) => <div className="col-md-6 col-xl-4" key={project.project_id}>
            <div className="cs-storage-quota"><div className="fw-semibold small">{project.name}</div><div className="small text-muted mt-2">No project storage limit configured</div></div>
          </div>)}
        </div>
      </section> : null}

      {rows.length === 0 ? <EmptyState title="No active volumes" description="Volumes appear here when a VM is provisioned or a data volume is attached to a project." /> :
        <section className="cs-card cs-card-body cs-table-card mb-3" aria-labelledby="volumes-heading">
          <div className="d-flex justify-content-between align-items-center mb-3"><h2 className="cs-card-title mb-0" id="volumes-heading">Volumes</h2><span className="small text-muted">{rows.length} records</span></div>
          <div className="table-responsive"><table className="table align-middle mb-0 cs-storage-volume-table"><thead><tr><th>Name</th><th>Project</th><th>Attached VM</th><th>Capacity & usage</th><th>Region</th><th>State</th><th>Created</th></tr></thead><tbody>
            {rows.map((volume) => <tr key={volume.volume_id}>
              <td><div className="fw-semibold">{volume.name}</div><small className="text-muted">{volume.is_root ? 'Root volume' : 'Data volume'} · {volume.volume_type}</small></td>
              <td>{volume.project_name}</td><td>{volume.vm_name ?? <span className="text-muted">Unattached</span>}</td>
              <td><div className="small text-nowrap">{gigabytes(volume.used_gb)} / {formatNumber(volume.size_gb)} GB</div><div className="cs-meter cs-meter-compact mt-1" role="progressbar" aria-label={`${volume.name} usage`} aria-valuenow={volume.size_gb > 0 ? Math.min(100, Math.round(Number(volume.used_gb) / volume.size_gb * 100)) : 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${volume.size_gb > 0 ? Math.min(100, Number(volume.used_gb) / volume.size_gb * 100) : 0}%` }} /></div></td>
              <td>{volume.region_code}</td><td><StatusBadge status={volume.state} /></td><td className="text-nowrap">{formatDateTime(volume.created_at)}</td>
            </tr>)}
          </tbody></table></div>
        </section>}
    </>}

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="snapshots-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="snapshots-heading"><Camera size={16} className="me-2" />Snapshots</h2><p className="small text-muted mb-0">Snapshot history and retention dates from the database.</p></div>{snapshots.data && <span className="small text-muted">{snapshots.data.length} records</span>}</div>
      {snapshots.isPending && <LoadingBlock rows={3} />}
      {snapshots.isError && <ErrorState error={snapshots.error} onRetry={() => snapshots.refetch()} title="Could not load snapshots" />}
      {snapshots.data?.length === 0 && <EmptyState title="No snapshots available" description="Snapshots will appear here after a snapshot record exists for one of your project volumes." />}
      {!!snapshots.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-storage-snapshot-table"><thead><tr><th>Snapshot</th><th>Volume / VM</th><th>Project</th><th>State</th><th>Size</th><th>Captured</th><th>Expires</th></tr></thead><tbody>
        {snapshots.data.map((snapshot) => <tr key={snapshot.snapshot_id}>
          <td className="fw-semibold">{snapshot.name}<div><small className="text-muted">{snapshot.retention_days} day retention</small></div></td>
          <td>{snapshot.volume_name}<div><small className="text-muted">{snapshot.vm_name ?? 'No VM attached'}</small></div></td>
          <td>{snapshot.project_name}</td><td><StatusBadge status={snapshot.status} /></td>
          <td>{snapshot.size_gb === null ? '—' : `${gigabytes(snapshot.size_gb)} GB`}</td>
          <td className="text-nowrap">{formatDateTime(snapshot.taken_at)}</td><td className="text-nowrap">{formatDateTime(snapshot.expires_at)}</td>
        </tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
