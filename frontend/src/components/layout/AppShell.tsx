import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Cloud } from 'lucide-react';
import Topbar from '@/components/layout/Topbar';
import { NAV_GROUPS } from '@/components/layout/nav';
import { useAuth } from '@/features/auth/AuthContext';
import { usePersistentFlag } from '@/hooks/usePersistentFlag';

export default function AppShell() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = usePersistentFlag('cs.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setMobileOpen(false), [pathname]);

  const groups = NAV_GROUPS.filter((g) => !g.roles || (user && g.roles.includes(user.role)));

  return (
    <div className={`cs-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className={`cs-sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Primary">
        <NavLink to="/" className="cs-brand" aria-label="CloudSphere home">
          <span className="cs-brand-mark"><Cloud size={19} color="#fff" aria-hidden /></span>
          <span className="cs-brand-name">CloudSphere</span>
        </NavLink>
        <nav className="cs-nav">
          {groups.map((group) => (
            <div key={group.heading}>
              <div className="cs-nav-heading">{group.heading}</div>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className="cs-nav-link" title={collapsed ? label : undefined}>
                  <Icon size={18} aria-hidden />
                  <span className="cs-nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {mobileOpen && <div className="cs-backdrop" onClick={() => setMobileOpen(false)} aria-hidden />}

      <div className="cs-main">
        <Topbar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} onOpenMobile={() => setMobileOpen(true)} />
        <main className="cs-content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
