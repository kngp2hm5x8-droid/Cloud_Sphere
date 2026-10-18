import PlannedModule from '@/components/common/PlannedModule';

export default function ProjectsPage() {
  return <PlannedModule title="Projects" subtitle="Create and manage projects, budgets and quota usage." endpoints={['GET /api/v1/projects', 'POST /api/v1/projects']} />;
}
