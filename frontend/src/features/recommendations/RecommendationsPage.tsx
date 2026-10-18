import PlannedModule from '@/components/common/PlannedModule';

export default function RecommendationsPage() {
  return <PlannedModule title="Recommendations" subtitle="Rule-based scaling and cost recommendations." endpoints={['GET /api/v1/recommendations', 'POST /api/v1/recommendations/:id/accept|reject']} />;
}
