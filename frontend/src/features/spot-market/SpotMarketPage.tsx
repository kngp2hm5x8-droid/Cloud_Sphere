import PlannedModule from '@/components/common/PlannedModule';

export default function SpotMarketPage() {
  return <PlannedModule title="Spot market" subtitle="Bid-based preemptible instances." endpoints={['GET /api/v1/spot-requests', 'POST /api/v1/spot-requests']} />;
}
