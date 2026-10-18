// API contract v0 (proposed). IDs and NUMERIC values arrive as STRINGS because node-postgres
// returns BIGINT/NUMERIC as strings. Field names are snake_case, matching the database.
// Successful responses: { data: T, meta?: PageMeta }. Errors: { error: { code, message, details? } }.

export type Role = 'customer' | 'admin';

export interface PageMeta {
  page: number;
  page_size: number;
  total: number;
}
export interface ApiResponse<T> {
  data: T;
  meta?: PageMeta;
}
export interface Page<T> {
  items: T[];
  meta: PageMeta;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface User {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  organization_id: string | null;
}

export type VmState =
  | 'REQUESTED'
  | 'PROVISIONING'
  | 'RUNNING'
  | 'STOPPED'
  | 'TERMINATED'
  | 'PREEMPTED'
  | 'FAILED';

export interface QuotaUsage {
  used_vcpu: number;
  max_vcpu: number;
  used_ram_gb: number;
  max_ram_gb: number;
  used_vms: number;
  max_vms: number;
}

export interface CustomerDashboardSummary {
  role: 'customer';
  total_vms: number;
  running_vms: number;
  stopped_vms: number;
  allocated_vcpu: number;
  allocated_ram_gb: number;
  quota: QuotaUsage | null;
  estimated_usage_charges: string;
  pending_recommendations: number;
  open_tickets: number;
}

export interface AdminDashboardSummary {
  role: 'admin';
  total_hosts: number;
  total_vms: number;
  total_cpu: number;
  allocated_cpu: number;
  total_ram_gb: number;
  allocated_ram_gb: number;
  hosts_near_capacity: number;
  active_organizations: number;
  active_projects: number;
  pending_spot_requests: number;
}

export type DashboardSummary = CustomerDashboardSummary | AdminDashboardSummary;
