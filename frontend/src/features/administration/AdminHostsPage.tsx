import PlannedModule from '@/components/common/PlannedModule';

export default function AdminHostsPage() {
  return <PlannedModule title="Hosts & capacity" subtitle="Host capacity, status and warning thresholds." endpoints={['GET /api/v1/hosts', 'PATCH /api/v1/hosts/:id/status']} />;
}
