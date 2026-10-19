import { useQuery } from '@tanstack/react-query';
import { Network, Scale, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/formatting';

interface VirtualNetwork {
  virtual_network_id: string; project_id: string; project_name: string; region_code: string;
  parent_network_id: string | null; parent_network_name: string | null; name: string; cidr_block: string;
  created_at: string; attached_vm_count: number; attached_vm_names: string; firewall_rule_count: number;
}
interface FirewallRule {
  firewall_rule_id: string; virtual_network_id: string; network_name: string; network_cidr: string;
  project_id: string; project_name: string; direction: 'INGRESS' | 'EGRESS'; action: 'ALLOW' | 'DENY';
  protocol: string; port_from: number | null; port_to: number | null; remote_cidr: string;
  priority: number; description: string | null; created_at: string;
}
interface LoadBalancer {
  load_balancer_id: string; project_id: string; project_name: string; virtual_network_id: string;
  network_name: string; network_cidr: string; name: string; algorithm: string;
  listener_protocol: string; listener_port: number; status: string; created_at: string;
  attached_vm_count: number; attached_vm_names: string;
}

function RulePorts({ rule }: { rule: FirewallRule }) {
  if (rule.port_from === null || rule.port_to === null) return <>All ports</>;
  return <>{rule.port_from === rule.port_to ? rule.port_from : `${rule.port_from}–${rule.port_to}`}</>;
}

export default function NetworkingPage() {
  const networks = useQuery({ queryKey: ['networking', 'networks'], queryFn: ({ signal }) => getData<VirtualNetwork[]>('/networks', undefined, signal) });
  const rules = useQuery({ queryKey: ['networking', 'firewall-rules'], queryFn: ({ signal }) => getData<FirewallRule[]>('/firewall-rules', undefined, signal) });
  const loadBalancers = useQuery({ queryKey: ['networking', 'load-balancers'], queryFn: ({ signal }) => getData<LoadBalancer[]>('/load-balancers', undefined, signal) });
  const networkRows = networks.data ?? [];
  const ruleRows = rules.data ?? [];
  const lbRows = loadBalancers.data ?? [];

  return <>
    <PageHeader title="Networks & security" subtitle="Project networks, subnet assignments, firewall policy, and load balancers from your CloudSphere database." />

    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-3"><StatCard label="Virtual networks" value={networks.data ? networkRows.filter((item) => item.parent_network_id === null).length : '—'} hint="Root CIDR ranges" icon={Network} /></div>
      <div className="col-sm-6 col-xl-3"><StatCard label="Subnets" value={networks.data ? networkRows.filter((item) => item.parent_network_id !== null).length : '—'} hint="Nested under a parent network" icon={Network} /></div>
      <div className="col-sm-6 col-xl-3"><StatCard label="Firewall rules" value={rules.data ? ruleRows.length : '—'} hint="Configured ingress and egress" icon={ShieldCheck} /></div>
      <div className="col-sm-6 col-xl-3"><StatCard label="Load balancers" value={loadBalancers.data ? lbRows.filter((item) => item.status === 'ACTIVE').length : '—'} hint="Active listeners" icon={Scale} /></div>
    </div>

    <section className="cs-card cs-card-body cs-table-card mb-3" aria-labelledby="networks-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="networks-heading">Virtual networks & subnets</h2><p className="small text-muted mb-0">CIDR ranges and VM attachments recorded for your projects.</p></div>{networks.data && <span className="small text-muted">{networkRows.length} records</span>}</div>
      {networks.isPending && <LoadingBlock rows={4} />}
      {networks.isError && <ErrorState error={networks.error} onRetry={() => networks.refetch()} title="Could not load networks" />}
      {networks.data?.length === 0 && <EmptyState title="No networks configured" description="Virtual networks and subnets will appear here when records exist for your projects." />}
      {!!networks.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>Name / type</th><th>Project</th><th>CIDR / parent</th><th>Region</th><th>Attached VMs</th><th>Firewall rules</th><th>Created</th></tr></thead><tbody>
        {networkRows.map((item) => <tr key={item.virtual_network_id}>
          <td><div className="fw-semibold">{item.name}</div><small className="text-muted">{item.parent_network_id === null ? 'Virtual network' : 'Subnet'}</small></td>
          <td>{item.project_name}</td>
          <td><code>{item.cidr_block}</code>{item.parent_network_name && <div className="small text-muted">in {item.parent_network_name}</div>}</td>
          <td>{item.region_code}</td>
          <td>{item.attached_vm_count ? <><span className="fw-semibold">{formatNumber(item.attached_vm_count)}</span><div className="small text-muted">{item.attached_vm_names}</div></> : <span className="text-muted">None</span>}</td>
          <td>{formatNumber(item.firewall_rule_count)}</td><td className="text-nowrap">{formatDateTime(item.created_at)}</td>
        </tr>)}
      </tbody></table></div>}
    </section>

    <section className="cs-card cs-card-body cs-table-card mb-3" aria-labelledby="firewall-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="firewall-heading"><ShieldCheck size={17} className="me-2" />Firewall rules</h2><p className="small text-muted mb-0">Configured actions, protocols, ports, and remote CIDR ranges.</p></div>{rules.data && <span className="small text-muted">{ruleRows.length} records</span>}</div>
      {rules.isPending && <LoadingBlock rows={4} />}
      {rules.isError && <ErrorState error={rules.error} onRetry={() => rules.refetch()} title="Could not load firewall rules" />}
      {rules.data?.length === 0 && <EmptyState title="No firewall rules configured" description="Firewall rules will appear here when they are recorded for your project networks." />}
      {!!rules.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>Network</th><th>Direction</th><th>Action</th><th>Protocol / ports</th><th>Remote CIDR</th><th>Priority</th><th>Description</th></tr></thead><tbody>
        {ruleRows.map((rule) => <tr key={rule.firewall_rule_id}>
          <td><div className="fw-semibold">{rule.network_name}</div><small className="text-muted">{rule.project_name} · {rule.network_cidr}</small></td>
          <td><StatusBadge status={rule.direction} /></td>
          <td><StatusBadge status={rule.action} /></td>
          <td>{rule.protocol}<div className="small text-muted"><RulePorts rule={rule} /></div></td>
          <td><code>{rule.remote_cidr}</code></td><td>{formatNumber(rule.priority)}</td><td>{rule.description ?? <span className="text-muted">—</span>}</td>
        </tr>)}
      </tbody></table></div>}
    </section>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="load-balancers-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="load-balancers-heading"><Scale size={17} className="me-2" />Load balancers</h2><p className="small text-muted mb-0">Listener settings and linked virtual machines from the database.</p></div>{loadBalancers.data && <span className="small text-muted">{lbRows.length} records</span>}</div>
      {loadBalancers.isPending && <LoadingBlock rows={3} />}
      {loadBalancers.isError && <ErrorState error={loadBalancers.error} onRetry={() => loadBalancers.refetch()} title="Could not load load balancers" />}
      {loadBalancers.data?.length === 0 && <EmptyState title="No load balancers configured" description="Load balancers will appear here when they are attached to your project networks." />}
      {!!loadBalancers.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>Name</th><th>Project / network</th><th>Listener</th><th>Algorithm</th><th>Attached VMs</th><th>Status</th><th>Created</th></tr></thead><tbody>
        {lbRows.map((lb) => <tr key={lb.load_balancer_id}>
          <td className="fw-semibold">{lb.name}</td>
          <td>{lb.project_name}<div className="small text-muted">{lb.network_name} · {lb.network_cidr}</div></td>
          <td>{lb.listener_protocol} : {formatNumber(lb.listener_port)}</td><td>{lb.algorithm.replaceAll('_', ' ')}</td>
          <td>{lb.attached_vm_count ? <><span className="fw-semibold">{formatNumber(lb.attached_vm_count)}</span><div className="small text-muted">{lb.attached_vm_names}</div></> : <span className="text-muted">None</span>}</td>
          <td><StatusBadge status={lb.status} /></td><td className="text-nowrap">{formatDateTime(lb.created_at)}</td>
        </tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
