import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, Spinner, TextField } from '../components/ui';
import { useCreateSlot, useCreateStation, useSlots, useStations, useUpdateSlot, useUpdateStation } from '../features/factory/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import type { Slot, Station } from '../lib/types';
import { localToIso } from '../lib/workflow';

const firstDetail = (err: unknown) => (err instanceof ApiError && Array.isArray(err.details) && err.details[0] ? err.details[0].message : errorMessage(err));

function CreateSlotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateSlot();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('3');
  const [error, setError] = useState<string | null>(null);
  const close = () => { setStart(''); setEnd(''); setCapacity('3'); setError(null); onClose(); };
  const submit = async () => {
    setError(null);
    const startsAt = localToIso(start);
    const endsAt = localToIso(end);
    const cap = Number(capacity);
    if (!startsAt || !endsAt) return setError('Choose both a start and an end time');
    if (!Number.isInteger(cap) || cap < 1) return setError('Capacity must be a whole number of at least 1');
    try {
      await create.mutateAsync({ startsAt, endsAt, capacity: cap });
      close();
    } catch (err) {
      setError(firstDetail(err));
    }
  };
  return (
    <Dialog open={open} title="Add an arrival slot" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">A slot is a time window in which vehicles may arrive. Capacity is the number of vehicles that can be booked into it.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="space-y-4">
        <TextField label="Starts" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <TextField label="Ends" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        <TextField label="Capacity (vehicles)" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} loading={create.isPending}>Add slot</Button>
      </div>
    </Dialog>
  );
}

function EditSlotDialog({ slot, onClose }: { slot: Slot | null; onClose: () => void }) {
  const update = useUpdateSlot();
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!slot) return null;
  const close = () => { setCapacity(''); setError(null); onClose(); };
  const save = async (body: { capacity?: number; isActive?: boolean }) => {
    setError(null);
    try {
      await update.mutateAsync({ id: slot.id, ...body });
      close();
    } catch (err) {
      setError(firstDetail(err));
    }
  };
  const cap = Number(capacity);
  return (
    <Dialog open title="Edit slot" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">{formatDateTime(slot.startsAt)} to {formatDateTime(slot.endsAt)} · {slot.bookedCount} of {slot.capacity} booked</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <TextField label="New capacity" inputMode="numeric" placeholder={String(slot.capacity)} value={capacity} onChange={(e) => setCapacity(e.target.value)} hint={`Cannot be lower than the ${slot.bookedCount} already booked`} />
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <Button variant="ghost" onClick={() => void save({ isActive: !slot.isActive })} disabled={update.isPending}>{slot.isActive ? 'Deactivate slot' : 'Reactivate slot'}</Button>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={close}>Back</Button>
          <Button onClick={() => void save({ capacity: cap })} disabled={!Number.isInteger(cap) || cap < 1} loading={update.isPending}>Save capacity</Button>
        </div>
      </div>
    </Dialog>
  );
}

function StationsCard() {
  const stations = useStations();
  const create = useCreateStation();
  const update = useUpdateStation();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim() });
      setName('');
    } catch (err) {
      setError(firstDetail(err));
    }
  };
  const toggle = async (s: Station) => {
    setError(null);
    try {
      await update.mutateAsync({ id: s.id, isActive: !s.isActive });
    } catch (err) {
      setError(firstDetail(err));
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">Processing stations</h2>
      <p className="mb-4 text-sm text-slate-600">Each station can process one shipment at a time.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="mb-4 flex items-end gap-3">
        <div className="flex-1"><TextField label="New station name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <Button onClick={() => void add()} disabled={name.trim().length < 2} loading={create.isPending}>Add station</Button>
      </div>
      {stations.isLoading ? <Spinner /> : stations.isError ? <Alert tone="error">{errorMessage(stations.error)}</Alert> : stations.data!.length === 0 ? (
        <EmptyState title="No stations yet">Add at least one so operators can start processing.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {stations.data!.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="font-medium">{s.name}</span>
              <span className="flex items-center gap-2">
                <Pill tone={s.isActive ? 'green' : 'slate'}>{s.isActive ? 'Active' : 'Inactive'}</Pill>
                {s.busy && <Pill tone="blue">Processing</Pill>}
                <Button variant="secondary" onClick={() => void toggle(s)} disabled={update.isPending}>{s.isActive ? 'Deactivate' : 'Activate'}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FactorySetupPage() {
  const { user } = useAuth();
  const [pageNo, setPageNo] = useState(1);
  const [past, setPast] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Slot | null>(null);
  const slots = useSlots({ page: pageNo, pageSize: 10, includePast: past ? 'true' : 'false' });

  return (
    <>
      <PageHeader
        title="Arrival slots"
        description="Time windows in which vehicles may arrive at the factory, and how many each can take."
        actions={<Button onClick={() => setCreating(true)}>Add slot</Button>}
      />
      <div className="space-y-6">
        <Card>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={past} onChange={(e) => { setPast(e.target.checked); setPageNo(1); }} className="size-4" />
            Include past slots
          </label>
          {slots.isLoading ? <Spinner label="Loading slots" /> : slots.isError ? <Alert tone="error">{errorMessage(slots.error)}</Alert> : slots.data!.items.length === 0 ? (
            <EmptyState title="No slots">Add a slot so shipments can be booked.</EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <caption className="sr-only">Arrival slots</caption>
                  <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr><th scope="col" className="py-2 pr-4">Starts</th><th scope="col" className="py-2 pr-4">Ends</th><th scope="col" className="py-2 pr-4 text-right">Booked</th><th scope="col" className="py-2 pr-4">Status</th><th scope="col" className="py-2"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {slots.data!.items.map((s) => (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap py-3 pr-4">{formatDateTime(s.startsAt)}</td>
                        <td className="whitespace-nowrap py-3 pr-4">{formatDateTime(s.endsAt)}</td>
                        <td className="py-3 pr-4 text-right">{s.bookedCount} / {s.capacity}</td>
                        <td className="py-3 pr-4"><span className="inline-flex gap-1"><Pill tone={s.isActive ? 'green' : 'slate'}>{s.isActive ? 'Active' : 'Inactive'}</Pill>{s.available === 0 && s.isActive && <Pill tone="amber">Full</Pill>}</span></td>
                        <td className="py-3 text-right"><Button variant="secondary" onClick={() => setEditing(s)}>Edit</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={slots.data!.meta.page} totalPages={slots.data!.meta.totalPages} total={slots.data!.meta.total} onChange={setPageNo} />
            </>
          )}
        </Card>
        {user?.role === 'ADMIN' && <StationsCard />}
      </div>
      <CreateSlotDialog open={creating} onClose={() => setCreating(false)} />
      <EditSlotDialog key={editing?.id ?? 'none'} slot={editing} onClose={() => setEditing(null)} />
    </>
  );
}
