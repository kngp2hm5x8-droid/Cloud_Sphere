import PlannedModule from '@/components/common/PlannedModule';

export default function SupportPage() {
  return <PlannedModule title="Support & feedback" subtitle="Support tickets and customer feedback." endpoints={['GET /api/v1/support/tickets', 'POST /api/v1/feedback']} />;
}
