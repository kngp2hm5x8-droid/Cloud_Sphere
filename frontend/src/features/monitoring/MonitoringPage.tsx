import PlannedModule from '@/components/common/PlannedModule';

export default function MonitoringPage() {
  return <PlannedModule title="Monitoring" subtitle="CPU, RAM, disk and network history from monitoring_log." endpoints={['GET /api/v1/monitoring/summary', 'GET /api/v1/vms/:vmId/metrics']} />;
}
