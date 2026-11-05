import { useState } from 'react';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, Spinner, TextField } from '../components/ui';
import { useBookings, useGateAction } from '../features/factory/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { WINDOW_LABELS, type Booking, type GateAction } from '../lib/types';
import { BookingPill } from './SchedulePages';

const LABELS: Record<GateAction, string> = {
  arrive: 'Vehicle arrived',
  verify: 'Verify vehicle',
  hold: 'Place on hold',
  reject: 'Refuse entry',
  admit: 'Admit to factory',
  exit: 'Vehicle leaving',
  releaseHold: 'Release hold',
  override: 'Override',
};

type Pending = { booking: Booking; action: 'verify' | 'hold' | 'reject' | 'admit' | 'exit' } | null;

function Progress({ b }: { b: Booking }) {
  const steps: [string, boolean][] = [['Arrived', b.gate.arrived], ['Verified', b.gate.verified], ['Admitted', b.gate.admitted], ['Weighed', b.weighed], ['Left', b.gate.exited]];
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Gate progress">
      {steps.map(([label, done]) => <li key={label} className={`rounded-full px-2 py-0.5 ${done ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-500'}`}>{done ? '✓ ' : ''}{label}</li>)}
    </ol>
  );
}

export function GatePage() {
  const [pageNo, setPageNo] = useState(1);
  const list = useBookings({ page: pageNo, pageSize: 20 }, 15_000); // refreshes by itself so the list stays current
  const gate = useGateAction();
  const [pending, setPending] = useState<Pending>(null);
  const [plate, setPlate] = useState('');
  const [errorFor, setErrorFor] = useState<{ id: string; message: string } | null>(null);

  const run = async (b: Booking, action: GateAction, extra: { registrationNumber?: string; reason?: string } = {}) => {
    setErrorFor(null);
    try {
      await gate.mutateAsync({ bookingId: b.id, action, ...extra });
    } catch (err) {
      setErrorFor({ id: b.id, message: err instanceof ApiError ? err.message : errorMessage(err) });
      throw err;
    }
  };
  const closePending = () => { setPending(null); setPlate(''); };

  return (
    <>
      <PageHeader title="Gate" description="Vehicles expected at, or inside, the factory. Record each step as it happens." />
      {list.isLoading ? <Spinner label="Loading expected vehicles" /> : list.isError ? <Alert tone="error">{errorMessage(list.error)}</Alert> : list.data!.items.length === 0 ? (
        <EmptyState title="No vehicles expected">Bookings made by the purchase team appear here.</EmptyState>
      ) : (
        <div className="space-y-4">
          {list.data!.items.map((b) => (
            <Card key={b.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{b.vehicleRegistration}</p>
                  <p className="text-sm text-slate-600">Shipment {b.shipment.code} · driver {b.driverName}</p>
                  <p className="text-sm text-slate-600">Slot {formatDateTime(b.slot.startsAt)} – {formatDateTime(b.slot.endsAt)} <Pill tone={b.window === 'IN_WINDOW' ? 'green' : 'amber'}>{WINDOW_LABELS[b.window]}</Pill></p>
                </div>
                <BookingPill booking={b} />
              </div>
              <div className="mt-3"><Progress b={b} /></div>
              {b.gate.held && <div className="mt-3"><Alert tone="warning">On hold. Only a purchase manager can release it.</Alert></div>}
              {b.gate.verified && !b.gate.admitted && b.window !== 'IN_WINDOW' && !b.gate.overridden && !b.gate.held && (
                <div className="mt-3"><Alert tone="info">Outside the booked time. A purchase manager must authorise entry before you can admit this vehicle.</Alert></div>
              )}
              {b.gate.admitted && !b.weighed && <div className="mt-3"><Alert tone="info">Waiting for the factory operator to weigh the vehicle in and out.</Alert></div>}
              {errorFor?.id === b.id && <div className="mt-3"><Alert tone="error">{errorFor.message}</Alert></div>}
              <div className="mt-4 flex flex-wrap gap-3">
                {b.actions.includes('arrive') && <Button onClick={() => void run(b, 'arrive').catch(() => undefined)} loading={gate.isPending}>{LABELS.arrive}</Button>}
                {b.actions.includes('verify') && <Button onClick={() => setPending({ booking: b, action: 'verify' })}>{LABELS.verify}</Button>}
                {b.actions.includes('admit') && <Button onClick={() => setPending({ booking: b, action: 'admit' })}>{LABELS.admit}</Button>}
                {b.actions.includes('exit') && <Button onClick={() => setPending({ booking: b, action: 'exit' })}>{LABELS.exit}</Button>}
                {b.actions.includes('hold') && <Button variant="secondary" onClick={() => setPending({ booking: b, action: 'hold' })}>{LABELS.hold}</Button>}
                {b.actions.includes('reject') && <Button variant="danger" onClick={() => setPending({ booking: b, action: 'reject' })}>{LABELS.reject}</Button>}
              </div>
            </Card>
          ))}
          <Pagination page={list.data!.meta.page} totalPages={list.data!.meta.totalPages} total={list.data!.meta.total} onChange={setPageNo} />
        </div>
      )}

      <Dialog open={pending?.action === 'verify'} title="Verify the vehicle" onClose={closePending}>
        <p className="mb-4 text-sm text-slate-600">Read the registration number from the vehicle and type it exactly as you see it.</p>
        <TextField label="Registration number on the vehicle" value={plate} onChange={(e) => setPlate(e.target.value)} autoComplete="off" />
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={closePending}>Back</Button>
          <Button disabled={plate.trim().length < 2} onClick={() => pending && void run(pending.booking, 'verify', { registrationNumber: plate.trim() }).then(closePending, closePending)}>Verify</Button>
        </div>
      </Dialog>
      <Dialog open={pending?.action === 'admit' || pending?.action === 'exit'} title={pending?.action === 'exit' ? 'Let this vehicle leave?' : 'Admit this vehicle?'} onClose={closePending}>
        <p className="mb-4 text-sm text-slate-600">{pending?.action === 'exit' ? 'Confirm it has been weighed in and out and is leaving the factory.' : 'Confirm the vehicle has been verified and may enter the factory.'}</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={closePending}>Back</Button>
          <Button onClick={() => pending && void run(pending.booking, pending.action as GateAction).then(closePending, closePending)}>{pending?.action === 'exit' ? 'Confirm exit' : 'Admit'}</Button>
        </div>
      </Dialog>
      <ReasonDialog open={pending?.action === 'hold'} title="Place this vehicle on hold?" description="It cannot be admitted until a purchase manager releases the hold." label="Why is it being held?" confirmLabel="Place on hold" onClose={closePending} onConfirm={(reason) => (pending ? run(pending.booking, 'hold', { reason }) : Promise.resolve())} />
      <ReasonDialog open={pending?.action === 'reject'} title="Refuse entry?" description="The booking is cancelled and the purchase manager is alerted. Give a clear reason." label="Reason for refusing entry" confirmLabel="Refuse entry" tone="danger" onClose={closePending} onConfirm={(reason) => (pending ? run(pending.booking, 'reject', { reason }) : Promise.resolve())} />
    </>
  );
}
