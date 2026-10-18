import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Breadcrumbs from '@/components/layout/Breadcrumbs';
import { useAuth } from '@/features/auth/AuthContext';
import { useToast } from '@/components/common/ToastProvider';
import { getData } from '@/lib/api-client';

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      toast.error('Logout request failed, but you have been signed out locally.');
    }
  };

  return (
    <div className="position-relative" ref={ref}>
      <button className="cs-profile-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="cs-avatar" aria-hidden>{initials(user.full_name)}</span>
        <span className="d-none d-md-inline small fw-semibold">{user.full_name}</span>
      </button>
      {open && (
        <div className="cs-menu" role="menu">
          <div className="px-2 py-2 border-bottom mb-1">
            <div className="fw-semibold">{user.full_name}</div>
            <div className="small text-muted text-break">{user.email}</div>
            <span className="cs-badge cs-badge--info mt-1 text-capitalize">{user.role}</span>
          </div>
          <button className="cs-menu-item" role="menuitem" onClick={onLogout}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Topbar({ collapsed, onToggleCollapsed, onOpenMobile }: Props) {
  // Only shown when the backend actually answers; no fabricated count otherwise.
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: ({ signal }) => getData<{ count: number }>('/notifications/unread-count', undefined, signal),
    retry: false,
    staleTime: 60_000,
  });
  const count = unread.data?.count ?? 0;

  return (
    <header className="cs-topbar">
      <button className="cs-icon-btn d-lg-none" onClick={onOpenMobile} aria-label="Open navigation">
        <Menu size={20} aria-hidden />
      </button>
      <button className="cs-icon-btn d-none d-lg-inline-grid" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <PanelLeftOpen size={20} aria-hidden /> : <PanelLeftClose size={20} aria-hidden />}
      </button>
      <Breadcrumbs />
      <div className="cs-topbar-spacer" />
      <Link to="/notifications" className="cs-icon-btn" aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}>
        <Bell size={19} aria-hidden />
        {count > 0 && <span className="cs-icon-badge">{count > 99 ? '99+' : count}</span>}
      </Link>
      <ProfileMenu />
    </header>
  );
}
