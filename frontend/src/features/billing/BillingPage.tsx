import { useQuery } from '@tanstack/react-query';
import { CreditCard, FileText, WalletCards } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/common/StateViews';
import { getData } from '@/lib/api-client';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/formatting';

interface Payment {
  payment_id: string; amount: string | number; method: string; status: string;
  transaction_ref: string; paid_at: string | null; created_at: string;
}
interface UsageBreakdown {
  simulated?: boolean; accrued_to?: string; compute_subtotal?: string | number;
  storage_subtotal?: string | number;
}
interface Invoice {
  invoice_id: string; project_id: string | null; project_name: string | null; invoice_type: 'SUBSCRIPTION' | 'USAGE';
  period_start: string; period_end: string; subtotal: string | number; tax_amount: string | number;
  total_amount: string | number; usage_breakdown: UsageBreakdown | null; status: string;
  issued_at: string | null; due_date: string | null; created_at: string; payments: Payment[];
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function InvoicePayments({ payments }: { payments: Payment[] }) {
  if (!payments.length) return <span className="text-muted">No payment recorded</span>;
  return <div className="cs-payment-list">{payments.map((payment) => <div key={payment.payment_id} className="cs-payment-row">
    <div className="d-flex justify-content-between gap-2"><StatusBadge status={payment.status} /><span className="fw-semibold">{formatCurrency(payment.amount)}</span></div>
    <div className="small text-muted mt-1">{payment.method.replaceAll('_', ' ')} · {payment.transaction_ref}</div>
    {payment.paid_at && <div className="small text-muted">Paid {formatDateTime(payment.paid_at)}</div>}
  </div>)}</div>;
}

export default function BillingPage() {
  const query = useQuery({ queryKey: ['billing', 'invoices'], queryFn: ({ signal }) => getData<Invoice[]>('/billing/invoices', undefined, signal) });
  const invoices = query.data ?? [];
  const balanceDue = invoices.filter((invoice) => ['ISSUED', 'OVERDUE'].includes(invoice.status))
    .reduce((sum, invoice) => {
      const successfulPayments = invoice.payments
        .filter((payment) => payment.status === 'SUCCEEDED')
        .reduce((paid, payment) => paid + Number(payment.amount), 0);
      return sum + Math.max(0, Number(invoice.total_amount) - successfulPayments);
    }, 0);
  const paidTotal = invoices.filter((invoice) => invoice.status === 'PAID')
    .reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);

  return <>
    <PageHeader title="Invoices & payments" subtitle="Simulated billing ledger from existing invoice and payment records. No real transactions are processed." />

    {query.isPending && <LoadingBlock rows={5} />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not load invoices" />}
    {query.data && <>
      <div className="row g-3 mb-3">
        <div className="col-sm-6 col-xl-4"><StatCard label="Invoices" value={formatNumber(invoices.length)} hint="All recorded billing periods" icon={FileText} /></div>
        <div className="col-sm-6 col-xl-4"><StatCard label="Balance due" value={formatCurrency(balanceDue)} hint="Issued and overdue invoices" icon={WalletCards} /></div>
        <div className="col-sm-6 col-xl-4"><StatCard label="Paid invoices" value={formatCurrency(paidTotal)} hint={`${invoices.filter((invoice) => invoice.status === 'PAID').length} marked paid`} icon={CreditCard} /></div>
      </div>

      {!invoices.length ? <EmptyState title="No invoices yet" description="Invoices and their payment history will appear here when billing records exist for your organization." /> :
        <section className="cs-card cs-card-body cs-table-card" aria-labelledby="invoice-heading">
          <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="cs-card-title mb-1" id="invoice-heading">Invoice history</h2><p className="small text-muted mb-0">Amounts and statuses are read from the billing ledger.</p></div><span className="small text-muted">{invoices.length} records</span></div>
          <div className="table-responsive"><table className="table align-middle mb-0 cs-billing-table"><thead><tr><th>Invoice</th><th>Period</th><th>Amount</th><th>Status</th><th>Due</th><th>Payment history</th></tr></thead><tbody>
            {invoices.map((invoice) => <tr key={invoice.invoice_id}>
              <td><div className="fw-semibold">INV-{invoice.invoice_id}</div><small className="text-muted">{invoice.invoice_type === 'SUBSCRIPTION' ? 'Subscription' : `Usage · ${invoice.project_name ?? 'Project'}`}</small>
                {invoice.usage_breakdown && <div className="small text-muted mt-1">{invoice.usage_breakdown.compute_subtotal !== undefined && <>Compute {formatCurrency(invoice.usage_breakdown.compute_subtotal)} · </>}{invoice.usage_breakdown.storage_subtotal !== undefined && <>Storage {formatCurrency(invoice.usage_breakdown.storage_subtotal)}</>}{invoice.usage_breakdown.simulated && <div>Simulated usage estimate</div>}</div>}
              </td>
              <td className="text-nowrap">{formatDate(invoice.period_start)}<div className="small text-muted">to {formatDate(invoice.period_end)}</div></td>
              <td><div className="fw-semibold">{formatCurrency(invoice.total_amount)}</div>{Number(invoice.tax_amount) > 0 && <small className="text-muted">Includes {formatCurrency(invoice.tax_amount)} tax</small>}</td>
              <td><StatusBadge status={invoice.status} /></td><td className="text-nowrap">{formatDate(invoice.due_date)}</td>
              <td><InvoicePayments payments={invoice.payments} /></td>
            </tr>)}
          </tbody></table></div>
        </section>}
    </>}
  </>;
}
