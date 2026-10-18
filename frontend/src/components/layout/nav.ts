import {
  Activity, Building2, Cpu, FolderKanban, Gauge, HardDrive, LayoutDashboard, Leaf, Layers,
  Lightbulb, LifeBuoy, Bell, Network, Receipt, ScrollText, Server, Zap, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types/api';

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }
export interface NavGroup { heading: string; items: NavItem[]; roles?: Role[] }

export const NAV_GROUPS: NavGroup[] = [
  { heading: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    heading: 'Compute',
    items: [
      { to: '/projects', label: 'Projects', icon: FolderKanban },
      { to: '/vms', label: 'Virtual machines', icon: Server },
      { to: '/spot-market', label: 'Spot market', icon: Zap },
    ],
  },
  {
    heading: 'Storage & network',
    items: [
      { to: '/storage', label: 'Storage & snapshots', icon: HardDrive },
      { to: '/networks', label: 'Networks & security', icon: Network },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { to: '/monitoring', label: 'Monitoring', icon: Activity },
      { to: '/recommendations', label: 'Recommendations', icon: Lightbulb },
      { to: '/sla-carbon', label: 'Carbon & SLA', icon: Leaf },
    ],
  },
  { heading: 'Billing', items: [{ to: '/billing', label: 'Invoices & payments', icon: Receipt }] },
  {
    heading: 'Support',
    items: [
      { to: '/support', label: 'Support & feedback', icon: LifeBuoy },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    heading: 'Administration',
    roles: ['admin'],
    items: [
      { to: '/admin/hosts', label: 'Hosts & capacity', icon: Cpu },
      { to: '/admin/organizations', label: 'Organizations & users', icon: Building2 },
      { to: '/admin/catalog', label: 'Plans, regions, configs', icon: Layers },
      { to: '/admin/quotas', label: 'Quotas', icon: Gauge },
      { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

export const ROUTE_LABELS: Record<string, string> = {
  projects: 'Projects',
  vms: 'Virtual machines',
  new: 'New VM',
  'spot-market': 'Spot market',
  storage: 'Storage & snapshots',
  networks: 'Networks & security',
  monitoring: 'Monitoring',
  recommendations: 'Recommendations',
  'sla-carbon': 'Carbon & SLA',
  billing: 'Invoices & payments',
  support: 'Support & feedback',
  notifications: 'Notifications',
  admin: 'Administration',
  hosts: 'Hosts & capacity',
  organizations: 'Organizations & users',
  catalog: 'Plans, regions, configs',
  quotas: 'Quotas',
  audit: 'Audit log',
  forbidden: 'Access denied',
};


