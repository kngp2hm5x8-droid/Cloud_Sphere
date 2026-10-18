import PlannedModule from '@/components/common/PlannedModule';

export default function AdminQuotasPage() {
  return <PlannedModule title="Quotas" subtitle="Organization and project resource quotas." endpoints={['GET /api/v1/quotas', 'PATCH /api/v1/quotas/:id']} />;
}
