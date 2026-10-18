import PlannedModule from '@/components/common/PlannedModule';

export default function VmDetailPage() {
  return <PlannedModule title="VM details" subtitle="Configuration, state, metrics, volumes and recommendations." endpoints={['GET /api/v1/vms/:vmId', 'GET /api/v1/vms/:vmId/metrics']} />;
}
