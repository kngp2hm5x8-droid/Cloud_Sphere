import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus, TicketCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { useToast } from '@/components/common/ToastProvider';
import { formatDateTime } from '@/lib/formatting';
import { getData, postData } from '@/lib/api-client';

interface Project { project_id: string; name: string; status: string }
interface Ticket {
  ticket_id: string; creator_name: string; project_id: string | null; project_name: string | null;
  vm_id: string | null; vm_name: string | null; subject: string; description: string;
  priority: string; status: string; resolved_at: string | null; created_at: string; updated_at: string;
}

export default function SupportPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [projectId, setProjectId] = useState('');
  const tickets = useQuery({ queryKey: ['support', 'tickets'], queryFn: ({ signal }) => getData<Ticket[]>('/support/tickets', undefined, signal) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: ({ signal }) => getData<Project[]>('/projects', undefined, signal) });
  const create = useMutation({
    mutationFn: () => postData<Ticket>('/support/tickets', { subject, description, priority, project_id: projectId || null }),
    onSuccess: async (ticket) => {
      setSubject(''); setDescription(''); setPriority('MEDIUM'); setProjectId('');
      toast.success(`Support ticket #${ticket.ticket_id} created.`);
      await queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not create support ticket.'),
  });
  const items = tickets.data ?? [];
  const openCount = items.filter((ticket) => !['RESOLVED','CLOSED'].includes(ticket.status)).length;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return <>
    <PageHeader title="Support & feedback" subtitle="Create a support ticket and follow ticket status recorded for your account and projects." />
    <div className="row g-3 mb-3">
      <div className="col-sm-6 col-xl-4"><StatCard label="Tickets" value={tickets.data ? items.length : '—'} hint="Visible to your account and organization" icon={LifeBuoy} /></div>
      <div className="col-sm-6 col-xl-4"><StatCard label="Open" value={tickets.data ? openCount : '—'} hint="Not resolved or closed" icon={TicketCheck} /></div>
    </div>

    <section className="cs-card cs-card-body mb-3" aria-labelledby="support-create-heading">
      <div className="d-flex align-items-start gap-2 mb-3"><Plus size={20} className="text-primary mt-1" /><div><h2 className="cs-card-title mb-1" id="support-create-heading">Open a support ticket</h2><p className="small text-muted mb-0">Ticket status changes are handled by support staff and are shown here when recorded.</p></div></div>
      {projects.isError && <ErrorState error={projects.error} onRetry={() => projects.refetch()} title="Could not load projects" />}
      {projects.isPending ? <LoadingBlock rows={2} /> : <form className="row g-3" onSubmit={submit}>
        <div className="col-md-7"><label className="form-label" htmlFor="support-subject">Subject</label><input id="support-subject" className="form-control" value={subject} onChange={(event) => setSubject(event.target.value)} minLength={5} maxLength={160} required placeholder="Briefly describe the issue" /></div>
        <div className="col-md-3"><label className="form-label" htmlFor="support-priority">Priority</label><select id="support-priority" className="form-select" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></select></div>
        <div className="col-md-2"><label className="form-label" htmlFor="support-project">Project</label><select id="support-project" className="form-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">General</option>{(projects.data ?? []).map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></div>
        <div className="col-12"><label className="form-label" htmlFor="support-description">Description</label><textarea id="support-description" className="form-control" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={5000} required placeholder="Add the details support will need to investigate." /></div>
        <div className="col-12"><button className="btn btn-primary" type="submit" disabled={create.isPending}>{create.isPending ? 'Submitting…' : 'Submit ticket'}</button></div>
      </form>}
    </section>

    <section className="cs-card cs-card-body cs-table-card" aria-labelledby="support-history-heading">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="support-history-heading">Ticket history</h2><p className="small text-muted mb-0">Includes tickets created by you or attached to your organization’s projects.</p></div>{tickets.data && <span className="small text-muted">{items.length} records</span>}</div>
      {tickets.isPending && <LoadingBlock rows={4} />}
      {tickets.isError && <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} title="Could not load support tickets" />}
      {tickets.data?.length === 0 && <EmptyState title="No support tickets" description="Tickets you submit will appear here with their current status." />}
      {!!tickets.data?.length && <div className="table-responsive"><table className="table align-middle mb-0 cs-network-table"><thead><tr><th>Ticket</th><th>Project / VM</th><th>Priority</th><th>Status</th><th>Created</th><th>Updated</th></tr></thead><tbody>{items.map((ticket) => <tr key={ticket.ticket_id}>
        <td><div className="fw-semibold">#{ticket.ticket_id} · {ticket.subject}</div><small className="text-muted">{ticket.description}</small><small className="d-block text-muted mt-1">Opened by {ticket.creator_name}</small></td>
        <td>{ticket.project_name ?? <span className="text-muted">General</span>}{ticket.vm_name && <small className="d-block text-muted">{ticket.vm_name}</small>}</td>
        <td><StatusBadge status={ticket.priority} /></td><td><StatusBadge status={ticket.status} /></td>
        <td className="text-nowrap">{formatDateTime(ticket.created_at)}</td><td className="text-nowrap">{formatDateTime(ticket.updated_at)}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </>;
}
