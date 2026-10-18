import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import NotFoundPage from '@/components/common/NotFoundPage';
import ProtectedRoute from '@/features/auth/ProtectedRoute';
import LoginPage from '@/features/auth/LoginPage';
import AccessDeniedPage from '@/features/auth/AccessDeniedPage';
import DashboardPage from '@/features/dashboard/DashboardPage';
import ProjectsPage from '@/features/projects/ProjectsPage';
import ProjectDetailPage from '@/features/projects/ProjectDetailPage';
import VmListPage from '@/features/virtual-machines/VmListPage';
import VmCreatePage from '@/features/virtual-machines/VmCreatePage';
import VmDetailPage from '@/features/virtual-machines/VmDetailPage';
import MonitoringPage from '@/features/monitoring/MonitoringPage';
import StoragePage from '@/features/storage/StoragePage';
import NetworkingPage from '@/features/networking/NetworkingPage';
import BillingPage from '@/features/billing/BillingPage';
import RecommendationsPage from '@/features/recommendations/RecommendationsPage';
import SpotMarketPage from '@/features/spot-market/SpotMarketPage';
import SlaCarbonPage from '@/features/sla-carbon/SlaCarbonPage';
import SupportPage from '@/features/support/SupportPage';
import NotificationsPage from '@/features/notifications/NotificationsPage';
import AdminHostsPage from '@/features/administration/AdminHostsPage';
import AdminOrganizationsPage from '@/features/administration/AdminOrganizationsPage';
import AdminCatalogPage from '@/features/administration/AdminCatalogPage';
import AdminQuotasPage from '@/features/administration/AdminQuotasPage';
import AdminAuditPage from '@/features/administration/AdminAuditPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'vms', element: <VmListPage /> },
      { path: 'vms/new', element: <VmCreatePage /> },
      { path: 'vms/:vmId', element: <VmDetailPage /> },
      { path: 'monitoring', element: <MonitoringPage /> },
      { path: 'storage', element: <StoragePage /> },
      { path: 'networks', element: <NetworkingPage /> },
      { path: 'billing', element: <BillingPage /> },
      { path: 'recommendations', element: <RecommendationsPage /> },
      { path: 'spot-market', element: <SpotMarketPage /> },
      { path: 'sla-carbon', element: <SlaCarbonPage /> },
      { path: 'support', element: <SupportPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      {
        path: 'admin',
        element: (
          <ProtectedRoute role="admin">
            <Outlet />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <Navigate to="hosts" replace /> },
          { path: 'hosts', element: <AdminHostsPage /> },
          { path: 'organizations', element: <AdminOrganizationsPage /> },
          { path: 'catalog', element: <AdminCatalogPage /> },
          { path: 'quotas', element: <AdminQuotasPage /> },
          { path: 'audit', element: <AdminAuditPage /> },
        ],
      },
      { path: 'forbidden', element: <AccessDeniedPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
