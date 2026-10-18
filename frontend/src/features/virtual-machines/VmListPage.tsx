import PlannedModule from '@/components/common/PlannedModule';

export default function VmListPage() {
  return <PlannedModule title="Virtual machines" subtitle="All VMs you are authorized to see, with lifecycle actions." endpoints={['GET /api/v1/vms', 'POST /api/v1/vms/:vmId/start|stop|terminate']} />;
}
