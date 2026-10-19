import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, CheckCheck } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { useToast } from '@/components/common/ToastProvider';
import { formatDateTime } from '@/lib/formatting';
import { getData, postData } from '@/lib/api-client';

interface Notification {
  notification_id: string; notification_type: string; title: string;
  payload: Record<string, unknown> | null; read_at: string | null;
  sent_at: string | null; created_at: string;
}

function payloadSummary(payload: Notification['payload']) {
  if (!payload) return null;
  const labels: Record<string, string> = { vm_id: 'VM', project_id: 'Project', recommendation_type: 'Recommendation', invoice_id: 'Invoice', host_id: 'Host' };
  const values = Object.entries(payload).filter(([key, value]) => labels[key] && (typeof value === 'string' || typeof value === 'number'));
  return values.length ? values.map(([key, value]) => `${labels[key]} ${value}`).join(' · ') : null;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ['notifications'], queryFn: ({ signal }) => getData<Notification[]>('/notifications', undefined, signal) });
  const markRead = useMutation({
    mutationFn: (id: string) => postData<Notification>(`/notifications/${id}/read`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] }),
      ]);
      toast.success('Notification marked as read.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update notification.'),
  });
  const items = query.data ?? [];
  const unread = items.filter((item) => item.read_at === null).length;

  return <>
    <PageHeader title="Notifications" subtitle="Messages sent to your account, with read status from the database." />
    <div className="d-flex align-items-center gap-2 mb-3 small text-muted"><Bell size={16} aria-hidden />{query.data ? `${unread} unread · ${items.length} total` : 'Loading your messages'}</div>
    {query.isPending && <LoadingBlock rows={4} />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load notifications" />}
    {query.data?.length === 0 && <EmptyState title="No notifications yet" description="Messages sent to your account will appear here." />}
    {!!query.data?.length && <div className="d-grid gap-2">
      {items.map((item) => {
        const summary = payloadSummary(item.payload);
        const isUnread = item.read_at === null;
        return <article className="cs-card cs-card-body" key={item.notification_id} aria-label={`${isUnread ? 'Unread' : 'Read'} notification: ${item.title}`}>
          <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-start gap-3">
            <div className="d-flex gap-3 min-w-0">
              <div className={`cs-state-icon ${isUnread ? 'is-info' : ''}`} aria-hidden><Bell size={18} /></div>
              <div className="min-w-0"><div className="d-flex flex-wrap align-items-center gap-2 mb-1"><h2 className="cs-card-title mb-0">{item.title}</h2><StatusBadge status={isUnread ? 'UNREAD' : 'READ'} /></div>
                <div className="small text-muted">{item.notification_type.replaceAll('_', ' ').toLowerCase()}</div>
                {summary && <div className="small mt-2">{summary}</div>}
                <div className="small text-muted mt-2">{formatDateTime(item.sent_at ?? item.created_at)}{item.read_at ? ` · Read ${formatDateTime(item.read_at)}` : ''}</div>
              </div>
            </div>
            {isUnread && <button type="button" className="btn btn-outline-primary btn-sm flex-shrink-0" disabled={markRead.isPending} onClick={() => markRead.mutate(item.notification_id)}><Check size={15} className="me-1" />Mark as read</button>}
            {!isUnread && <span className="small text-muted flex-shrink-0"><CheckCheck size={15} className="me-1" />Read</span>}
          </div>
        </article>;
      })}
    </div>}
  </>;
}
