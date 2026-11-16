import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PaymentLine, PaymentPill, paymentMessage } from '../components/PaymentParts';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, SelectField, Spinner, TextField } from '../components/ui';
import { useDecidePayment, usePayment, usePayments, useSettlePayment } from '../features/payments/hooks';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatInr, formatKg } from '../lib/format';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentRow, type PaymentState } from '../lib/types';

const BASIS_TEXT = { FACTORY_WEIGHT: 'Weight recorded at the factory', COLLECTED_QUANTITY: 'Quantity collected at the farm' } as const;

/** Pay Now, Pay Later, or paying a Pay Later delivery after processing. */
function PayDialog({ row, mode, onClose }: { row: PaymentRow; mode: 'PAY_NOW' | 'PAY_LATER' | 'SETTLE'; onClose: () => void }) {
  const decide = useDecidePayment(row.shipmentId);
  const settle = useSettlePayment(row.shipmentId);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const paying = mode !== 'PAY_LATER';
  const busy = decide.isPending || settle.isPending;

  const submit = async () => {
    setError(null);
    const details = { ...(method ? { method } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) };
    try {
      if (mode === 'SETTLE') await settle.mutateAsync(details);
      else await decide.mutateAsync({ option: mode, ...(paying ? details : {}) });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open title={mode === 'PAY_LATER' ? 'Pay later' : mode === 'SETTLE' ? 'Pay now (after processing)' : 'Pay now'} onClose={onClose}>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {paying ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">An invoice is created and shown to the farmer straight away.</p>
          <dl className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 text-sm">
            <dt className="text-slate-600">Quantity</dt><dd>{formatKg(row.estimate.quantityKg)}</dd>
            <dt className="text-slate-600">Rate</dt><dd>{formatInr(row.estimate.ratePerKg)} per kg</dd>
            <dt className="font-medium">Amount</dt><dd className="font-semibold">{formatInr(row.estimate.amountInr)}</dd>
          </dl>
          <p className="text-xs text-slate-500">{BASIS_TEXT[row.estimate.quantityBasis]}.</p>
          <SelectField label="Paid by (optional)" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Not recorded</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
          </SelectField>
          <TextField label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} hint="For example a bank or UPI transaction number" />
        </div>
      ) : (
        <p className="text-sm text-slate-600">The farmer will be told the payment will be credited after processing is completed. You can pay it from this page once processing is done.</p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Back</Button>
        <Button onClick={() => void submit()} loading={busy}>{mode === 'PAY_LATER' ? 'Confirm pay later' : 'Pay and create invoice'}</Button>
      </div>
    </Dialog>
  );
}

export function PaymentsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const raw = params.get('state');
  const state = raw === 'AWAITING_DECISION' || raw === 'PAY_LATER' || raw === 'PAID' ? (raw as PaymentState) : undefined;
  const list = usePayments({ page, state });
  const [dialog, setDialog] = useState<{ row: PaymentRow; mode: 'PAY_NOW' | 'PAY_LATER' | 'SETTLE' } | null>(null);
  const manager = user?.role === 'PURCHASE_MANAGER';
  const farmer = user?.role === 'FARMER';

  return (
    <div className="space-y-4">
      <PageHeader title={farmer ? 'My payments' : 'Payments'} description={farmer ? 'Payment status and invoices for prawns you delivered.' : 'Once the transport officer has delivered the prawns to the factory, choose Pay Now or Pay Later.'} />
      <div className="flex flex-wrap gap-2 text-sm">
        {([['', 'All'], ['AWAITING_DECISION', 'Awaiting decision'], ['PAY_LATER', 'Pay later'], ['PAID', 'Paid']] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setParams(v ? { state: v } : {})} className={`rounded-full px-3 py-1 ${(state ?? '') === v ? 'bg-teal-700 text-white' : 'bg-slate-200 text-slate-700'}`}>{label}</button>
        ))}
      </div>
      {list.isLoading ? <Spinner /> : list.isError ? <Alert tone="error">{errorMessage(list.error)}</Alert> : list.data!.items.length === 0 ? (
        <EmptyState title="No payments yet">Deliveries appear here once the transport officer has handed the prawns over at the factory.</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {list.data!.items.map((p) => (
              <li key={p.shipmentId} className="py-1">
                {farmer ? <ul><PaymentLine p={p} showRequest /></ul> : (
                  <div className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                    <span>
                      <Link className="font-medium text-teal-800 underline" to={`/requests/${p.request.id}`}>{p.request.code}</Link> · {p.shipmentCode} · {p.request.species}
                      <span className="block text-slate-600">{p.request.farmerName} · {formatKg(p.estimate.quantityKg)} × {formatInr(p.estimate.ratePerKg)} = <strong>{formatInr(p.invoice?.amountInr ?? p.estimate.amountInr)}</strong></span>
                      <span className="block text-slate-600">{p.deliveredAt ? `Delivered ${formatDateTime(p.deliveredAt)} · ` : ''}{paymentMessage(p)}</span>
                    </span>
                    <span className="flex flex-col items-end gap-2">
                      <PaymentPill state={p.state} />
                      {p.invoice && <Link className="text-teal-800 underline" to={`/payments/${p.shipmentId}/invoice`}>View invoice</Link>}
                      {manager && p.state === 'AWAITING_DECISION' && (
                        <span className="flex gap-2"><Button onClick={() => setDialog({ row: p, mode: 'PAY_NOW' })}>Pay now</Button><Button variant="secondary" onClick={() => setDialog({ row: p, mode: 'PAY_LATER' })}>Pay later</Button></span>
                      )}
                      {manager && p.canSettle && <Button onClick={() => setDialog({ row: p, mode: 'SETTLE' })}>Pay now</Button>}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={list.data!.meta.page} totalPages={list.data!.meta.totalPages} total={list.data!.meta.total} onChange={(n) => setParams({ ...(state ? { state } : {}), page: String(n) })} />
        </Card>
      )}
      {dialog && <PayDialog row={dialog.row} mode={dialog.mode} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** A printable invoice. Shown to the farmer who was paid, and to the purchase manager and administrator. */
export function InvoicePage() {
  const { shipmentId = '' } = useParams();
  const q = usePayment(shipmentId);
  const navigate = useNavigate();
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const p = q.data!;
  const inv = p.invoice;
  if (!inv) return <Alert tone="info">{paymentMessage(p)}</Alert>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>← Back</Button>
        <Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
      </div>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div><h1 className="text-xl font-semibold">Invoice</h1><p className="text-sm text-slate-600">Prawn Factory Management System</p></div>
          <div className="text-right text-sm"><p className="font-mono font-semibold">{inv.invoiceNumber}</p><p className="text-slate-600">Issued {formatDate(inv.invoicedAt)}</p><p className="mt-1 inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">Paid {formatDate(inv.paidAt)}</p></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-sm">
          <dt className="text-slate-600">Paid to</dt><dd>{inv.farmer.name}</dd>
          <dt className="text-slate-600">Purchase order</dt><dd>{p.request.code}</dd>
          <dt className="text-slate-600">Delivery</dt><dd>{p.shipmentCode}</dd>
          <dt className="text-slate-600">Prawns</dt><dd>{p.request.species} · size {p.request.declaredSizeCount}</dd>
          <dt className="text-slate-600">Quantity</dt><dd>{formatKg(inv.quantityKg)}<span className="block text-xs text-slate-500">{BASIS_TEXT[inv.quantityBasis]}</span></dd>
          <dt className="text-slate-600">Rate</dt><dd>{formatInr(inv.ratePerKg)} per kg</dd>
          <dt className="text-slate-600">Payment method</dt><dd>{inv.method ? PAYMENT_METHOD_LABELS[inv.method as keyof typeof PAYMENT_METHOD_LABELS] ?? inv.method : 'Not recorded'}</dd>
          <dt className="text-slate-600">Reference</dt><dd>{inv.reference ?? '—'}</dd>
          <dt className="text-slate-600">Paid by</dt><dd>{inv.paidBy}</dd>
        </dl>
        <div className="flex items-center justify-between border-t border-slate-200 pt-4"><span className="font-medium">Total paid</span><span className="text-2xl font-semibold">{formatInr(inv.amountInr)}</span></div>
      </Card>
    </div>
  );
}
