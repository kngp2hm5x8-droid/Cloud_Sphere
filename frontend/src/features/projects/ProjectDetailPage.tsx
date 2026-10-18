import PlannedModule from '@/components/common/PlannedModule';

export default function ProjectDetailPage() {
  return <PlannedModule title="Project details" subtitle="Configuration, resources and quota for one project." endpoints={['GET /api/v1/projects/:projectId', 'GET /api/v1/quotas']} />;
}
