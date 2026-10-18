import PlannedModule from '@/components/common/PlannedModule';

export default function StoragePage() {
  return <PlannedModule title="Storage & snapshots" subtitle="Volumes, attachments and backup snapshots." endpoints={['GET /api/v1/volumes', 'GET /api/v1/snapshots']} />;
}
