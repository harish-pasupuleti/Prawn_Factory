import { Link } from 'react-router-dom';
import { formatDate, formatInr, formatKg } from '../lib/format';
import type { PaymentRow } from '../lib/types';
import { Pill } from './ui';

/** The plain-language payment status shown to the farmer (and to staff). */
export function paymentMessage(p: PaymentRow): string {
  if (p.state === 'PAID') return `Paid on ${formatDate(p.invoice!.paidAt)}. Invoice ${p.invoice!.invoiceNumber}.`;
  if (p.state === 'PAY_LATER') {
    return p.processingCompleted ? 'Processing is completed. Your payment will be credited shortly.' : 'Your payment will be credited after the processing is completed.';
  }
  return 'Your prawns have reached the factory. The purchase manager is deciding how to pay.';
}

export function PaymentPill({ state }: { state: PaymentRow['state'] }) {
  if (state === 'PAID') return <Pill tone="green">Paid</Pill>;
  if (state === 'PAY_LATER') return <Pill tone="blue">Pay later</Pill>;
  return <Pill tone="amber">Awaiting decision</Pill>;
}

/** One delivery's payment status, with a link to the invoice once it exists. */
export function PaymentLine({ p, showRequest = false }: { p: PaymentRow; showRequest?: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
      <span>
        <span className="font-medium">{showRequest ? <Link className="text-teal-800 underline" to={`/requests/${p.request.id}`}>{p.request.code}</Link> : p.shipmentCode}</span>
        <span className="text-slate-600"> · {p.request.species} · {formatKg(p.estimate.quantityKg)}</span>
        <span className="mt-0.5 block text-slate-700">{paymentMessage(p)}</span>
        {p.invoice && <span className="mt-0.5 block text-slate-600">Amount {formatInr(p.invoice.amountInr)}</span>}
      </span>
      <span className="flex flex-col items-end gap-2">
        <PaymentPill state={p.state} />
        {p.invoice && <Link className="text-teal-800 underline" to={`/payments/${p.shipmentId}/invoice`}>View invoice</Link>}
      </span>
    </li>
  );
}
