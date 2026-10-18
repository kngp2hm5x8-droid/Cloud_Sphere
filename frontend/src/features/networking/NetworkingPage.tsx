import PlannedModule from '@/components/common/PlannedModule';

export default function NetworkingPage() {
  return <PlannedModule title="Networks & security" subtitle="Virtual networks, subnets, firewall rules and load balancers." endpoints={['GET /api/v1/networks', 'GET /api/v1/firewall-rules', 'GET /api/v1/load-balancers']} />;
}
