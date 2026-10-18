import PlannedModule from '@/components/common/PlannedModule';

export default function NotificationsPage() {
  return <PlannedModule title="Notifications" subtitle="Your notifications with read/unread state." endpoints={['GET /api/v1/notifications', 'POST /api/v1/notifications/:id/read']} />;
}
