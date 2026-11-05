import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner } from '../components/ui';
import {
  useBooking, useBookings, useCancelBooking, useCreateBooking, useGateAction, useNoShow, useRescheduleBooking, useSlots,
} from '../features/factory/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { BOOKING_STATUS_LABELS, SHIPMENT_STATUS_LABELS, WINDOW_LABELS, type Booking, type BookingStatus } from '../lib/types';

export function BookingPill({ booking }: { booking: Pick<Booking, 'status' | 'gate' | 'window'> }) {
  const tone = booking.status === 'COMPLETED' ? 'green' : booking.status === 'CHECKED_IN' ? 'blue' : booking.status === 'RESERVED' ? 'violet' : booking.status === 'NO_SHOW' ? 'red' : 'slate';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Pill tone={tone}>{BOOKING_STATUS_LABELS[booking.status]}</Pill>
      {booking.gate.held && <Pill tone="amber">On hold</Pill>}
      {booking.status === 'RESERVED' && booking.window === 'LATE' && <Pill tone="red">Late</Pill>}
    </span>
  );
}

const STATUSES: BookingStatus[] = ['RESERVED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW'];

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status = (STATUSES as string[]).includes(statusParam ?? '') ? (statusParam as BookingStatus) : '';
  const result = useBookings({ page, pageSize: 10, status });

  const update = (patch: Record<string, string | undefined>, reset = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (reset) next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Arrival schedule" description="Shipments booked into factory arrival slots, and their gate progress." actions={<Link to="/factory/slots" className="text-sm font-medium text-teal-800 underline">Manage slots</Link>} />
      <Card className="mb-4">
        <div className="max-w-xs">
          <SelectField label="Status" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All bookings</option>
            {STATUSES.map((s) => <option key={s} value={s}>{BOOKING_STATUS_LABELS[s]}</option>)}
          </SelectField>
        </div>
      </Card>
      {result.isLoading ? <Spinner label="Loading schedule" /> : result.isError ? <Alert tone="error">{errorMessage(result.error)}</Alert> : result.data!.items.length === 0 ? (
        <EmptyState title="No bookings">Book a shipment from a collection job to see it here.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Bookings</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr><th scope="col" className="px-4 py-3">Shipment</th><th scope="col" className="px-4 py-3">Vehicle / driver</th><th scope="col" className="px-4 py-3">Slot</th><th scope="col" className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3"><Link to={`/schedule/${b.id}`} className="font-medium text-teal-800 underline">{b.shipment.code}</Link></td>
                    <td className="px-4 py-3">{b.vehicleRegistration}<span className="block text-xs text-slate-500">{b.driverName}</span></td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(b.slot.startsAt)}<span className="block text-xs text-slate-500">to {formatDateTime(b.slot.endsAt)}</span></td>
                    <td className="px-4 py-3"><BookingPill booking={b} /></td>
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

/** Pick a slot with room. Used both to book and to reschedule. */
function SlotPicker({ value, onChange, excludeId }: { value: string; onChange: (id: string) => void; excludeId?: string }) {
  const slots = useSlots({ pageSize: 100, active: 'true' });
  if (slots.isLoading) return <Spinner />;
  if (slots.isError) return <Alert tone="error">{errorMessage(slots.error)}</Alert>;
  const options = slots.data!.items.filter((s) => s.id !== excludeId);
  if (options.length === 0) return <Alert tone="warning">There are no upcoming slots. Add one under "Arrival slots" first.</Alert>;
  return (
    <SelectField label="Arrival slot" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a slot…</option>
      {options.map((s) => (
        <option key={s.id} value={s.id} disabled={s.available === 0}>
          {formatDateTime(s.startsAt)} – {formatDateTime(s.endsAt)} ({s.available} of {s.capacity} free{s.available === 0 ? ', full' : ''})
        </option>
      ))}
    </SelectField>
  );
}

/** Book a collection job into an arrival slot. Rendered from the collection page by the Purchase Manager. */
export function BookSlotDialog({ collectionJobId, open, onClose }: { collectionJobId: string; open: boolean; onClose: () => void }) {
  const create = useCreateBooking();
  const [slotId, setSlotId] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const close = () => { setSlotId(''); setError(null); onClose(); };
  const submit = async () => {
    setError(null);
    try {
      await create.mutateAsync({ collectionJobId, slotId });
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    }
  };
  return (
    <Dialog open title="Book an arrival slot" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">The vehicle is expected at the gate during this window. Arrivals outside it need a manager’s override.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <SlotPicker value={slotId} onChange={setSlotId} />
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!slotId} loading={create.isPending}>Book slot</Button>
      </div>
    </Dialog>
  );
}

function RescheduleDialog({ booking, open, onClose }: { booking: Booking; open: boolean; onClose: () => void }) {
  const reschedule = useRescheduleBooking(booking.id);
  const [slotId, setSlotId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const close = () => { setSlotId(''); setReason(''); setError(null); onClose(); };
  const submit = async () => {
    setError(null);
    try {
      await reschedule.mutateAsync({ slotId, reason: reason.trim() });
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open title="Reschedule arrival" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">The current booking is kept as history and the new one takes its place.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="space-y-4">
        <SlotPicker value={slotId} onChange={setSlotId} excludeId={booking.slot.id} />
        <label className="block text-sm font-medium text-slate-800">
          Reason
          <textarea className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!slotId || reason.trim().length < 3} loading={reschedule.isPending}>Reschedule</Button>
      </div>
    </Dialog>
  );
}

type Dlg = 'reschedule' | 'cancel' | 'noshow' | 'release' | 'override' | null;

export function BookingDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: b, isLoading, isError, error } = useBooking(id);
  const cancel = useCancelBooking(id ?? '');
  const noShow = useNoShow(id ?? '');
  const gate = useGateAction();
  const [dlg, setDlg] = useState<Dlg>(null);
  if (isLoading) return <Spinner label="Loading booking" />;
  if (isError || !b) return <Alert tone="error">{error instanceof ApiError && error.status === 404 ? 'Booking not found.' : errorMessage(error)}</Alert>;
  const manager = user?.role === 'PURCHASE_MANAGER';
  const close = () => setDlg(null);

  return (
    <>
      <PageHeader title={`Booking · ${b.shipment.code}`} description={`${b.vehicleRegistration} · driver ${b.driverName}`} actions={<BookingPill booking={b} />} />
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-base font-semibold">Arrival slot</h2>
            <p className="text-sm">{formatDateTime(b.slot.startsAt)} to {formatDateTime(b.slot.endsAt)}</p>
            <p className="mt-2 text-sm text-slate-600">Right now the vehicle would be: <strong>{WINDOW_LABELS[b.window]}</strong></p>
            <p className="mt-1 text-sm text-slate-600">Shipment: {SHIPMENT_STATUS_LABELS[b.shipment.status]}</p>
            {b.request && <p className="mt-1 text-sm"><Link className="font-medium text-teal-800 underline" to={`/requests/${b.request.id}`}>{b.request.code}</Link></p>}
            {b.reason && <p className="mt-2 text-sm text-slate-600">Reason on record: {b.reason}</p>}
          </Card>
          <Card>
            <h2 className="mb-3 text-base font-semibold">Gate progress</h2>
            <ul className="space-y-1 text-sm">
              {[['Arrived', b.gate.arrived], ['Verified', b.gate.verified], ['Admitted', b.gate.admitted], ['Weighed in and out', b.weighed], ['Left the factory', b.gate.exited]].map(([label, done]) => (
                <li key={String(label)} className={done ? 'font-medium text-teal-800' : 'text-slate-500'}>{done ? '✓' : '○'} {String(label)}</li>
              ))}
            </ul>
            {b.gate.held && <div className="mt-3"><Alert tone="warning">The vehicle is on hold. A purchase manager must release it.</Alert></div>}
          </Card>
        </div>

        {manager && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Actions</h2>
            <div className="flex flex-wrap gap-3">
              {b.canReschedule && <Button onClick={() => setDlg('reschedule')}>Reschedule</Button>}
              {b.actions.includes('releaseHold') && <Button onClick={() => setDlg('release')}>Release hold</Button>}
              {b.actions.includes('override') && <Button variant="secondary" onClick={() => setDlg('override')}>Authorise entry outside the window</Button>}
              {b.status === 'RESERVED' && !b.gate.arrived && b.window === 'LATE' && <Button variant="secondary" onClick={() => setDlg('noshow')}>Mark as no-show</Button>}
              {b.canCancel && <Button variant="ghost" className="text-red-700" onClick={() => setDlg('cancel')}>Cancel booking</Button>}
              {!b.canReschedule && !b.actions.length && !b.canCancel && <p className="text-sm text-slate-600">No actions are available for this booking.</p>}
            </div>
          </Card>
        )}

        {b.events && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Gate history</h2>
            {b.events.length === 0 ? <p className="text-sm text-slate-600">Nothing has happened at the gate yet.</p> : (
              <ol className="space-y-3 border-l-2 border-slate-200 pl-5">
                {b.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-teal-700 ring-4 ring-white" />
                    <p className="text-sm font-medium">{e.type.replace('_', ' ').toLowerCase()} · {e.by}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(e.at)}</p>
                    {e.reason && <p className="mt-1 text-sm">{e.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}
      </div>
      <RescheduleDialog booking={b} open={dlg === 'reschedule'} onClose={close} />
      <ReasonDialog open={dlg === 'cancel'} title="Cancel this booking?" description="The place in the slot is freed. You can book the shipment again later." label="Reason" confirmLabel="Cancel booking" tone="danger" onClose={close} onConfirm={(reason) => cancel.mutateAsync({ reason })} />
      <ReasonDialog open={dlg === 'noshow'} title="Mark as no-show?" description="Use this when the vehicle never arrived and the slot has ended." label="Note (optional)" confirmLabel="Mark no-show" required={false} onClose={close} onConfirm={(reason) => noShow.mutateAsync(reason ? { reason } : {})} />
      <ReasonDialog open={dlg === 'release'} title="Release the hold?" description="The vehicle can then be admitted. Your reason is recorded with your name." label="Why is it safe to release?" confirmLabel="Release hold" onClose={close} onConfirm={(reason) => gate.mutateAsync({ bookingId: b.id, action: 'releaseHold', reason })} />
      <ReasonDialog open={dlg === 'override'} title="Authorise entry outside the time window?" description="This is an exception to the schedule. Your reason is recorded with your name." label="Reason" confirmLabel="Authorise entry" onClose={close} onConfirm={(reason) => gate.mutateAsync({ bookingId: b.id, action: 'override', reason })} />
    </>
  );
}
