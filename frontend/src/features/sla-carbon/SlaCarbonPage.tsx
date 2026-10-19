import { useQuery } from '@tanstack/react-query';
import { Gauge, Leaf, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/formatting';

interface CarbonProfile {
  carbon_profile_id: string; region_id: string; region_code: string; region_name: string;
  country: string | null; version: number; carbon_intensity_gco2_kwh: number | string;
  effective_from: string; effective_to: string | null;
}
interface SlaRecord {
  sla_record_id: string; vm_id: string; vm_name: string; project_id: string; project_name: string;
  region_code: string | null; region_name: string | null; plan_name: string;
  period_start: string; period_end: string; target_uptime_pct: number | string;
  measured_uptime_pct: number | string; expected_samples: number; received_samples: number;
  downtime_minutes: number | string; is_breach: boolean; computed_at: string;
}

export default function SlaCarbonPage() {
  const carbon = useQuery({ queryKey: ['carbon-profiles'], queryFn: ({ signal }) => getData<CarbonProfile[]>('/carbon-profiles', undefined, signal) });
  const sla = useQuery({ queryKey: ['sla-records'], queryFn: ({ signal }) => getData<SlaRecord[]>('/sla-records', undefined, signal) });
  const carbonRows = carbon.data ?? [];
  const slaRows = sla.data ?? [];
  const maxIntensity = Math.max(...carbonRows.map((row) => Number(row.carbon_intensity_gco2_kwh)), 0);
  const breaches = slaRows.filter((row) => row.is_breach).length;
  const averageUptime = slaRows.length
    ? slaRows.reduce((sum, row) => sum + Number(row.measured_uptime_pct), 0) / slaRows.length
    : null;

  return <>
    <PageHeader title="Carbon & SLA" subtitle="Current regional carbon profiles and recorded VM uptime evaluations from the database." />

    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Regions with current profiles" value={carbon.data ? formatNumber(carbonRows.length) : '—'} hint="Latest effective profile for active regions" icon={Leaf} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="SLA evaluations" value={sla.data ? formatNumber(slaRows.length) : '—'} hint="Recorded evaluation periods for your VMs" icon={Gauge} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="SLA breaches" value={sla.data ? formatNumber(breaches) : '—'} hint={averageUptime === null ? 'No evaluation data available' : `Average measured uptime ${formatPercent(averageUptime, 3)}`} icon={ShieldCheck} /></div>
    </div>

    <section className="cs-card cs-card-body mb-3" aria-labelledby="carbon-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="carbon-heading"><Leaf size={17} className="me-2" />Regional carbon intensity</h2><p className="small text-muted mb-0">Current profile values in grams of CO₂ per kilowatt-hour.</p></div>{carbon.data && <span className="small text-muted">{carbonRows.length} regions</span>}</div>
      {carbon.isPending && <LoadingBlock rows={3} />}
      {carbon.isError && <ErrorState error={carbon.error} onRetry={() => carbon.refetch()} title="Could not load carbon profiles" />}
      {carbon.data?.length === 0 && <EmptyState title="No current carbon profiles" description="There are no active regional carbon profile records to display." />}
      {!!carbon.data?.length && <div className="row g-3">{carbonRows.map((row) => {
        const intensity = Number(row.carbon_intensity_gco2_kwh);
        const width = maxIntensity > 0 ? Math.max(2, Math.round((intensity / maxIntensity) * 100)) : 0;
        return <div className="col-md-6" key={row.carbon_profile_id}>
          <div className="cs-storage-quota">
            <div className="d-flex justify-content-between gap-3 mb-2"><div><div className="fw-semibold">{row.region_name} <span className="text-muted">· {row.region_code}</span></div><div className="small text-muted">{row.country ?? 'Country not specified'} · Profile v{row.version}</div></div><div className="text-end"><div className="fw-semibold">{formatNumber(intensity, 2)}</div><div className="small text-muted">gCO₂/kWh</div></div></div>
            <div className="cs-meter" role="progressbar" aria-label={`${row.region_name} carbon intensity relative to the highest current region`} aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${width}%` }} /></div>
            <div className="small text-muted mt-2">Effective from {formatDateTime(row.effective_from)}</div>
          </div>
        </div>;
      })}</div>}
    </section>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="sla-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="sla-heading"><ShieldCheck size={17} className="me-2" />VM SLA evaluations</h2><p className="small text-muted mb-0">Measured uptime and sample coverage for each stored evaluation period.</p></div>{sla.data && <span className="small text-muted">{slaRows.length} records</span>}</div>
      {sla.isPending && <LoadingBlock rows={4} />}
      {sla.isError && <ErrorState error={sla.error} onRetry={() => sla.refetch()} title="Could not load SLA records" />}
      {sla.data?.length === 0 && <EmptyState title="No SLA evaluations yet" description="Recorded SLA periods will appear here when evaluations exist for your organization's VMs." />}
      {!!sla.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>VM / project</th><th>Evaluation period</th><th>Plan target</th><th>Measured uptime</th><th>Sample coverage</th><th>Downtime</th><th>Result</th></tr></thead><tbody>
        {slaRows.map((row) => <tr key={row.sla_record_id}>
          <td><div className="fw-semibold">{row.vm_name}</div><small className="text-muted">{row.project_name}{row.region_code ? ` · ${row.region_code}` : ''}</small></td>
          <td className="text-nowrap">{formatDateTime(row.period_start)}<div className="small text-muted">to {formatDateTime(row.period_end)}</div></td>
          <td>{formatPercent(row.target_uptime_pct, 3)}<div className="small text-muted">{row.plan_name}</div></td>
          <td className="fw-semibold">{formatPercent(row.measured_uptime_pct, 3)}</td>
          <td>{formatNumber(row.received_samples)} / {formatNumber(row.expected_samples)}<div className="small text-muted">monitoring samples</div></td>
          <td>{formatNumber(row.downtime_minutes, 2)} min</td>
          <td><StatusBadge status={row.is_breach ? 'BREACH' : 'COMPLIANT'} /></td>
        </tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
