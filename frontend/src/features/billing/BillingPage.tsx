import PlannedModule from '@/components/common/PlannedModule';

export default function BillingPage() {
  return <PlannedModule title="Invoices & payments" subtitle="Invoices and simulated payments." endpoints={['GET /api/v1/billing/invoices', 'POST /api/v1/billing/invoices/:id/pay']} />;
}
