import PlannedModule from '@/components/common/PlannedModule';

export default function AdminCatalogPage() {
  return <PlannedModule title="Plans, regions, configs" subtitle="Subscription plans, regions, carbon profiles and VM configurations." endpoints={['GET /api/v1/admin/plans', 'GET /api/v1/regions', 'GET /api/v1/configurations']} />;
}
