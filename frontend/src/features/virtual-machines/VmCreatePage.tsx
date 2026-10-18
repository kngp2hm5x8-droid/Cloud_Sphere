import PlannedModule from '@/components/common/PlannedModule';

export default function VmCreatePage() {
  return <PlannedModule title="Request a virtual machine" subtitle="Multi-step provisioning wizard backed by the allocation routine." endpoints={['GET /api/v1/configurations', 'GET /api/v1/regions', 'POST /api/v1/vms']} />;
}
