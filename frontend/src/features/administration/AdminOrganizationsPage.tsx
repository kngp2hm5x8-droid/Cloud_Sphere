import { useQuery } from '@tanstack/react-query';
import { Building2, Users } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/formatting';

interface Organization {
  organization_id: string; name: string; billing_email: string; status: string; plan_name: string;
  user_count: number; project_count: number; vm_count: number; created_at: string;
}
interface User {
  user_id: string; organization_id: string | null; organization_name: string | null; email: string;
  full_name: string; role: string; is_active: boolean; last_login_at: string | null; created_at: string;
}

export default function AdminOrganizationsPage() {
  const organizations = useQuery({ queryKey: ['admin', 'organizations'], queryFn: ({ signal }) => getData<Organization[]>('/admin/organizations', undefined, signal) });
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: ({ signal }) => getData<User[]>('/admin/users', undefined, signal) });
  const active = (organizations.data ?? []).filter((item) => item.status === 'ACTIVE').length;
  const customerUsers = (users.data ?? []).filter((item) => item.role === 'customer').length;

  return <>
    <PageHeader title="Organizations & users" subtitle="Organization membership and account details from the CloudSphere database." />
    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Organizations" value={organizations.data ? formatNumber(organizations.data.length) : '—'} hint={`${active} active`} icon={Building2} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="User accounts" value={users.data ? formatNumber(users.data.length) : '—'} hint={`${customerUsers} customer accounts`} icon={Users} /></div>
    </div>

    <section className="cs-card cs-card-body cs-table-card mb-3" aria-labelledby="organizations-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="organizations-heading">Organizations</h2><p className="small text-muted mb-0">Plan membership and related resource counts.</p></div>{organizations.data && <span className="small text-muted">{organizations.data.length} records</span>}</div>
      {organizations.isPending && <LoadingBlock rows={3} />}
      {organizations.isError && <ErrorState error={organizations.error} onRetry={() => organizations.refetch()} title="Could not load organizations" />}
      {organizations.data?.length === 0 && <EmptyState title="No organizations" description="Organization records will appear here." />}
      {!!organizations.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>Organization</th><th>Plan</th><th>Users</th><th>Projects</th><th>VMs</th><th>Status</th><th>Created</th></tr></thead><tbody>{organizations.data.map((item) => <tr key={item.organization_id}>
        <td><div className="fw-semibold">{item.name}</div><small className="text-muted">{item.billing_email}</small></td><td>{item.plan_name}</td><td>{formatNumber(item.user_count)}</td><td>{formatNumber(item.project_count)}</td><td>{formatNumber(item.vm_count)}</td><td><StatusBadge status={item.status} /></td><td className="text-nowrap">{formatDateTime(item.created_at)}</td>
      </tr>)}</tbody></table></div>}
    </section>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="users-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="users-heading">User accounts</h2><p className="small text-muted mb-0">Password hashes are never included in this view.</p></div>{users.data && <span className="small text-muted">{users.data.length} records</span>}</div>
      {users.isPending && <LoadingBlock rows={3} />}
      {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} title="Could not load user accounts" />}
      {users.data?.length === 0 && <EmptyState title="No user accounts" description="User records will appear here." />}
      {!!users.data?.length && <div className="table-responsive"><table className="table align-middle mb-0"><thead><tr><th>User</th><th>Organization</th><th>Role</th><th>Account</th><th>Last sign in</th></tr></thead><tbody>{users.data.map((item) => <tr key={item.user_id}>
        <td><div className="fw-semibold">{item.full_name}</div><small className="text-muted">{item.email} · #{item.user_id}</small></td><td>{item.organization_name ?? <span className="text-muted">Platform</span>}</td><td className="text-capitalize">{item.role}</td><td><StatusBadge status={item.is_active ? 'ACTIVE' : 'INACTIVE'} /></td><td className="text-nowrap">{item.last_login_at ? formatDateTime(item.last_login_at) : <span className="text-muted">Never</span>}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </>;
}
