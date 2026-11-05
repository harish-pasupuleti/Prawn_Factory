import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner, TextAreaField } from '../components/ui';
import { useAddExceptionNote, useException, useExceptions, useResolveException } from '../features/factory/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { EXCEPTION_TYPE_LABELS, type ExceptionStatus } from '../lib/types';

const DETAIL_LABELS: Record<string, string> = {
  collectedKg: 'Collected (kg)',
  receivedKg: 'Received (kg)',
  variancePct: 'Difference (%)',
  thresholdPct: 'Allowed (%)',
  direction: 'Direction',
  reason: 'Reason',
};

export function ExceptionsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status: ExceptionStatus | '' = statusParam === 'OPEN' || statusParam === 'RESOLVED' ? statusParam : '';
  const result = useExceptions({ page, pageSize: 10, status });
  const update = (patch: Record<string, string | undefined>, reset = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (reset) next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Exceptions" description="Gate refusals and weight discrepancies that need a manager’s attention." />
      <Card className="mb-4">
        <div className="max-w-xs">
          <SelectField label="Status" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option>
          </SelectField>
        </div>
      </Card>
      {result.isLoading ? <Spinner label="Loading exceptions" /> : result.isError ? <Alert tone="error">{errorMessage(result.error)}</Alert> : result.data!.items.length === 0 ? (
        <EmptyState title="No exceptions">{status === 'OPEN' ? 'Nothing needs attention.' : 'Nothing has been flagged.'}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Exceptions</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr><th scope="col" className="px-4 py-3">Type</th><th scope="col" className="px-4 py-3">Summary</th><th scope="col" className="px-4 py-3">Shipment</th><th scope="col" className="px-4 py-3">Raised</th><th scope="col" className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3"><Link to={`/exceptions/${e.id}`} className="font-medium text-teal-800 underline">{EXCEPTION_TYPE_LABELS[e.type]}</Link></td>
                    <td className="px-4 py-3">{e.summary}</td>
                    <td className="whitespace-nowrap px-4 py-3">{e.shipment.code}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(e.createdAt)}</td>
                    <td className="px-4 py-3"><Pill tone={e.status === 'OPEN' ? 'red' : 'green'}>{e.status === 'OPEN' ? 'Open' : 'Resolved'}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data!.meta.page} totalPages={result.data!.meta.totalPages} total={result.data!.meta.total} onChange={(p) => update({ page: String(p) }, false)} />
        </>
      )}
    </>
  );
}

export function ExceptionDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: e, isLoading, isError, error } = useException(id);
  const addNote = useAddExceptionNote(id ?? '');
  const resolve = useResolveException(id ?? '');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  if (isLoading) return <Spinner label="Loading exception" />;
  if (isError || !e) return <Alert tone="error">{error instanceof ApiError && error.status === 404 ? 'Exception not found.' : errorMessage(error)}</Alert>;

  const submitNote = async () => {
    setNoteError(null);
    try {
      await addNote.mutateAsync({ note: note.trim() });
      setNote('');
    } catch (err) {
      setNoteError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title={EXCEPTION_TYPE_LABELS[e.type]} description={e.summary} actions={<Pill tone={e.status === 'OPEN' ? 'red' : 'green'}>{e.status === 'OPEN' ? 'Open' : 'Resolved'}</Pill>} />
      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 text-base font-semibold">Details</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Shipment</dt><dd><Link className="font-medium text-teal-800 underline" to={`/shipments/${e.shipment.id}`}>{e.shipment.code}</Link></dd></div>
            <div><dt className="text-slate-500">Request</dt><dd><Link className="font-medium text-teal-800 underline" to={`/requests/${e.request.id}`}>{e.request.code}</Link></dd></div>
            <div><dt className="text-slate-500">Raised by</dt><dd>{e.raisedBy} · {formatDateTime(e.createdAt)}</dd></div>
            {e.details && Object.entries(e.details).filter(([k]) => k !== 'bookingId').map(([k, v]) => (
              <div key={k}><dt className="text-slate-500">{DETAIL_LABELS[k] ?? k}</dt><dd className="font-medium">{String(v)}</dd></div>
            ))}
          </dl>
          {e.status === 'RESOLVED' && <p className="mt-4 text-sm"><strong>Resolved</strong> by {e.resolvedBy} {e.resolvedAt ? `on ${formatDateTime(e.resolvedAt)}` : ''}: {e.resolution}</p>}
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold">History</h2>
          <ol className="space-y-3 border-l-2 border-slate-200 pl-5">
            {e.events.map((ev) => (
              <li key={ev.id} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-teal-700 ring-4 ring-white" />
                <p className="text-sm font-medium">{{ RAISED: 'Raised', NOTE: 'Note', RESOLVED: 'Resolved' }[ev.type]} · {ev.by}</p>
                <p className="text-xs text-slate-500">{formatDateTime(ev.at)}</p>
                <p className="mt-1 text-sm">{ev.note}</p>
              </li>
            ))}
          </ol>
        </Card>

        {e.status === 'OPEN' && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Follow up</h2>
            {noteError && <div className="mb-3"><Alert tone="error">{noteError}</Alert></div>}
            <TextAreaField label="Add a note" rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} />
            <div className="mt-3 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => void submitNote()} disabled={note.trim().length < 3} loading={addNote.isPending}>Add note</Button>
              {user?.role === 'PURCHASE_MANAGER' && <Button onClick={() => setResolving(true)}>Resolve exception</Button>}
            </div>
          </Card>
        )}
      </div>
      <ReasonDialog open={resolving} title="Resolve this exception?" description="Resolving authorises the shipment to continue. Explain why it is acceptable; this is recorded with your name." label="Resolution" confirmLabel="Resolve" onClose={() => setResolving(false)} onConfirm={(resolution) => resolve.mutateAsync({ resolution })} />
    </>
  );
}
