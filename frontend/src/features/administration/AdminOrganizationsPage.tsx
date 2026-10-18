import PlannedModule from '@/components/common/PlannedModule';

export default function AdminOrganizationsPage() {
  return <PlannedModule title="Organizations & users" subtitle="Organizations, users and roles." endpoints={['GET /api/v1/admin/organizations', 'GET /api/v1/admin/users']} />;
}
