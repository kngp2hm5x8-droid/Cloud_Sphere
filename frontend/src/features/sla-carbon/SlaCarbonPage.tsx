import PlannedModule from '@/components/common/PlannedModule';

export default function SlaCarbonPage() {
  return <PlannedModule title="Carbon & SLA" subtitle="Simulated carbon intensity by region and VM uptime versus SLA targets." endpoints={['GET /api/v1/carbon-profiles', 'GET /api/v1/sla-records']} />;
}
