import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { FieldEvidence } from '../components/FieldEvidence';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner, TextAreaField, TextField } from '../components/ui';
import {
  useArrive, useCancelCollection, useCollection, useCollections, useDispatch, useHandover, useLoad, usePickup, useReportIncident,
} from '../features/fieldwork/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatKg } from '../lib/format';
import { COLLECTION_STATUS_LABELS, INCIDENT_LABELS, type Collection, type CollectionStatus, type IncidentType } from '../lib/types';
import { BookSlotDialog } from './SchedulePages';
import { canCancelCollection, isCollectionActive, localToIso, nextTransportAction, TRANSPORT_STEPS } from '../lib/workflow';

export function CollectionStatusPill({ collection }: { collection: Pick<Collection, 'status' | 'overdue'> }) {
  const tone = collection.status === 'HANDED_OVER' ? 'green' : collection.status === 'CANCELLED' ? 'slate' : collection.status === 'ASSIGNED' ? 'violet' : 'blue';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Pill tone={tone}>{COLLECTION_STATUS_LABELS[collection.status]}</Pill>
      {collection.overdue && <Pill tone="red">Overdue</Pill>}
    </span>
  );
}

const STATUSES: CollectionStatus[] = ['ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED', 'HANDED_OVER', 'CANCELLED'];

export function CollectionsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status = (STATUSES as string[]).includes(statusParam ?? '') ? (statusParam as CollectionStatus) : '';
  const result = useCollections({ page, pageSize: 10, status });
  const mine = user?.role === 'TRANSPORT_OFFICER';
  const fieldOfficer = user?.role === 'FIELD_OFFICER';

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (resetPage) next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader title={mine ? 'My collections' : fieldOfficer ? 'Collections to attend' : 'Collection jobs'} description={mine ? 'Pickups assigned to you.' : fieldOfficer ? 'Pickups for requests you inspected. Go with the transport officer, photograph the load and seal it.' : 'All transport assignments and their progress.'} />
      <Card className="mb-4">
        <div className="max-w-xs">
          <SelectField label="Status" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{COLLECTION_STATUS_LABELS[s]}</option>
            ))}
          </SelectField>
        </div>
      </Card>

      {result.isLoading ? (
        <Spinner label="Loading collections" />
      ) : result.isError ? (
        <Alert tone="error">{errorMessage(result.error, 'Could not load collections.')}</Alert>
      ) : result.data!.items.length === 0 ? (
        <EmptyState title="No collection jobs match">{mine ? 'New assignments will appear here.' : fieldOfficer ? 'Once transport is assigned to a request you passed, it appears here.' : 'Assign transport from a request whose inspection passed.'}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Collection jobs</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Request</th>
                  <th scope="col" className="px-4 py-3">Pickup</th>
                  <th scope="col" className="px-4 py-3">Vehicle</th>
                  {!mine && <th scope="col" className="px-4 py-3">Officer</th>}
                  <th scope="col" className="px-4 py-3">Expected arrival</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3"><Link to={`/collections/${c.id}`} className="font-medium text-teal-800 underline">{c.request.code}</Link></td>
                    <td className="px-4 py-3">{c.request.farmer.village}, {c.request.farmer.district}</td>
                    <td className="whitespace-nowrap px-4 py-3">{c.vehicle.registrationNumber}</td>
                    {!mine && <td className="px-4 py-3">{c.transportOfficer.name}</td>}
                    <td className="whitespace-nowrap px-4 py-3">{c.expectedArrivalAt ? formatDateTime(c.expectedArrivalAt) : '—'}</td>
                    <td className="px-4 py-3"><CollectionStatusPill collection={c} /></td>
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

// ------------------------------------------------------------------ action panels
const loadSchema = z.object({
  collectedQuantityKg: z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, 'Quantity must be a number with at most 3 decimal places').refine((v) => /[1-9]/.test(v), 'Quantity must be greater than zero'),
  notes: z.string().trim().max(1000).optional(),
});
type LoadValues = z.infer<typeof loadSchema>;

function LoadForm({ collection }: { collection: Collection }) {
  const load = useLoad(collection.id);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setError: setFieldError, formState: { errors } } = useForm<LoadValues>({ resolver: zodResolver(loadSchema), defaultValues: { notes: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await load.mutateAsync({ collectedQuantityKg: values.collectedQuantityKg, ...(values.notes ? { notes: values.notes } : {}) });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EXCEEDS_VEHICLE_CAPACITY') setFieldError('collectedQuantityKg', { type: 'server', message: err.message });
      else if (err instanceof ApiError && err.code === 'NOTES_REQUIRED') setFieldError('notes', { type: 'server', message: err.message });
      else setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm text-slate-600">Inspected: <strong>{collection.request.inspectedQuantityKg ? formatKg(collection.request.inspectedQuantityKg) : 'n/a'}</strong> · Vehicle capacity: <strong>{formatKg(collection.vehicle.capacityKg)}</strong></p>
      <TextField label="Quantity actually collected (kg)" inputMode="decimal" error={errors.collectedQuantityKg?.message} {...register('collectedQuantityKg')} />
      <TextAreaField label="Notes" rows={2} hint="Required when the quantity differs noticeably from the inspected quantity." error={errors.notes?.message} {...register('notes')} />
      <Button type="submit" loading={load.isPending}>Record loading</Button>
    </form>
  );
}

function DispatchForm({ collection }: { collection: Collection }) {
  const dispatch = useDispatch(collection.id);
  const [eta, setEta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsEta = !collection.expectedArrivalAt;
  const submit = async () => {
    setError(null);
    try {
      await dispatch.mutateAsync({ expectedArrivalAt: localToIso(eta) });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField label={needsEta ? 'Expected arrival at the factory' : 'Update expected arrival (optional)'} type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} hint={collection.expectedArrivalAt ? `Currently ${formatDateTime(collection.expectedArrivalAt)}` : 'Required before dispatch'} />
      <Button onClick={() => void submit()} disabled={needsEta && !eta} loading={dispatch.isPending}>Dispatch to factory</Button>
    </div>
  );
}

function SimpleStep({ label, description, run, pending, children }: { label: string; description: string; run: () => Promise<unknown>; pending: boolean; children?: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{description}</p>
      {children}
      {error && <Alert tone="error">{error}</Alert>}
      <Button loading={pending} onClick={() => { setError(null); run().catch((e: unknown) => setError(errorMessage(e))); }}>{label}</Button>
    </div>
  );
}

function IncidentDialog({ collection, open, onClose }: { collection: Collection; open: boolean; onClose: () => void }) {
  const report = useReportIncident(collection.id);
  const [type, setType] = useState<IncidentType>('DELAY');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => { setDescription(''); setQuantity(''); setError(null); onClose(); };
  const submit = async () => {
    setError(null);
    try {
      await report.mutateAsync({ type, description: description.trim(), ...(quantity.trim() ? { quantityAffectedKg: quantity.trim() } : {}) });
      close();
    } catch (err) {
      setError(err instanceof ApiError && Array.isArray(err.details) && err.details[0] ? err.details[0].message : errorMessage(err));
    }
  };
  return (
    <Dialog open={open} title="Report an incident" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">Incidents are recorded permanently and do not change any weights.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="space-y-4">
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
          {(Object.keys(INCIDENT_LABELS) as IncidentType[]).map((t) => <option key={t} value={t}>{INCIDENT_LABELS[t]}</option>)}
        </SelectField>
        <TextAreaField label="What happened?" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <TextField label="Quantity affected (kg, optional)" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={description.trim().length < 3} loading={report.isPending}>Report incident</Button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ detail
export function CollectionDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: c, isLoading, isError, error } = useCollection(id);
  const pickup = usePickup(id ?? '');
  const arrive = useArrive(id ?? '');
  const handover = useHandover(id ?? '');
  const cancel = useCancelCollection(id ?? '');
  const [dialog, setDialog] = useState<'incident' | 'cancel' | 'book' | null>(null);
  const [handoverNote, setHandoverNote] = useState('');

  if (isLoading) return <Spinner label="Loading collection" />;
  if (isError || !c) {
    const missing = error instanceof ApiError && error.status === 404;
    return <Alert tone="error">{missing ? 'This collection job does not exist or is not assigned to you.' : errorMessage(error)}</Alert>;
  }

  const isDriver = user?.role === 'TRANSPORT_OFFICER';
  const isManager = user?.role === 'PURCHASE_MANAGER';
  const next = nextTransportAction(c.status);
  const d = c.request.declaration;
  const reached = (field: string) => (c as unknown as Record<string, string | null>)[field];

  return (
    <>
      <PageHeader title={`Collection · ${c.request.code}`} description={`Assigned ${formatDateTime(c.assignedAt)} to ${c.transportOfficer.name}`} actions={<CollectionStatusPill collection={c} />} />
      <div className="space-y-6">
        {c.overdue && <Alert tone="warning">Expected arrival was {c.expectedArrivalAt ? formatDateTime(c.expectedArrivalAt) : ''}. This collection is overdue.</Alert>}
        {c.arrivedLate && <Alert tone="info">Arrived after the expected time.</Alert>}
        {c.status === 'CANCELLED' && <Alert tone="warning">This job was cancelled{c.cancelReason ? `: ${c.cancelReason}` : '.'}</Alert>}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <h2 className="mb-3 text-base font-semibold">Pickup</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-500">Farmer</dt><dd className="font-medium">{c.request.farmer.name}</dd></div>
              <div><dt className="text-slate-500">Mobile</dt><dd>{c.request.farmer.phone}</dd></div>
              <div><dt className="text-slate-500">Location</dt><dd>{c.request.farmer.village}, {c.request.farmer.district}, {c.request.farmer.state}</dd></div>
              <div><dt className="text-slate-500">Scheduled pickup</dt><dd>{c.scheduledPickupAt ? formatDateTime(c.scheduledPickupAt) : 'Not scheduled'}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 text-base font-semibold">Consignment</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-500">Species / size</dt><dd className="font-medium">{d.species} · {d.declaredSizeCount}</dd></div>
              <div><dt className="text-slate-500">Declared</dt><dd>{formatKg(d.declaredQuantityKg)}</dd></div>
              <div><dt className="text-slate-500">Inspected</dt><dd>{c.request.inspectedQuantityKg ? formatKg(c.request.inspectedQuantityKg) : '—'}</dd></div>
              <div><dt className="text-slate-500">Collected</dt><dd className="font-medium">{c.collectedQuantityKg ? formatKg(c.collectedQuantityKg) : '—'}</dd></div>
              <div><dt className="text-slate-500">Available from</dt><dd>{formatDate(d.availabilityDate)}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 text-base font-semibold">Vehicle and timing</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-500">Vehicle</dt><dd className="font-medium">{c.vehicle.registrationNumber}</dd></div>
              <div><dt className="text-slate-500">Capacity</dt><dd>{formatKg(c.vehicle.capacityKg)}</dd></div>
              <div><dt className="text-slate-500">Expected arrival</dt><dd>{c.expectedArrivalAt ? formatDateTime(c.expectedArrivalAt) : 'Not set'}</dd></div>
            </dl>
          </Card>
        </div>

        {c.shipment && (
          <Card>
            <h2 className="mb-2 text-base font-semibold">Factory arrival</h2>
            <p className="text-sm text-slate-600">Shipment code <strong>{c.shipment.code}</strong>{c.shipment.booking ? <> · slot {formatDateTime(c.shipment.booking.startsAt)} – {formatDateTime(c.shipment.booking.endsAt)}</> : ' · no slot booked'}</p>
          </Card>
        )}
        {isManager && isCollectionActive(c.status) && !c.shipment?.booking && (
          <Alert tone="info">
            No arrival slot is booked for this job yet. <button type="button" className="font-medium underline" onClick={() => setDialog('book')}>Book a slot</button>
          </Alert>
        )}

        <Card>
          <h2 className="mb-3 text-base font-semibold">Progress</h2>
          <ol className="space-y-3 border-l-2 border-slate-200 pl-5">
            {TRANSPORT_STEPS.map((step) => {
              const at = step.field === 'assignedAt' ? c.assignedAt : reached(step.field);
              return (
                <li key={step.status} className="relative">
                  <span aria-hidden className={`absolute -left-[27px] top-1.5 size-3 rounded-full ring-4 ring-white ${at ? 'bg-teal-700' : 'bg-slate-300'}`} />
                  <p className={`text-sm font-medium ${at ? '' : 'text-slate-500'}`}>{step.label}</p>
                  <p className="text-xs text-slate-500">{at ? formatDateTime(at) : 'Pending'}</p>
                </li>
              );
            })}
          </ol>
          {c.collectionNotes && <p className="mt-4 text-sm"><strong>Collection note:</strong> {c.collectionNotes}</p>}
          {c.handoverNotes && <p className="mt-2 text-sm"><strong>Handover note:</strong> {c.handoverNotes}</p>}
        </Card>

        {isDriver && next && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Next step</h2>
            {next === 'pickup' && <SimpleStep label="Confirm pickup" description="Confirm you have arrived at the farm and started collecting. The time is recorded by the server." run={() => pickup.mutateAsync(undefined)} pending={pickup.isPending} />}
            {next === 'load' && <LoadForm collection={c} />}
            {next === 'dispatch' && (c.sealed ? <DispatchForm collection={c} /> : <Alert tone="info">Waiting for the field officer to photograph and seal the load. You can dispatch once it is sealed.</Alert>)}
            {next === 'arrive' && <SimpleStep label="Mark arrived at factory" description="Confirm the vehicle has reached the factory gate." run={() => arrive.mutateAsync(undefined)} pending={arrive.isPending} />}
            {next === 'handover' && (
              <SimpleStep label="Record handover" description="Confirm the consignment has been handed over to factory staff. This completes your job." run={() => handover.mutateAsync(handoverNote.trim() ? { notes: handoverNote.trim() } : {})} pending={handover.isPending}>
                <TextAreaField label="Handover note (optional)" rows={2} value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} />
              </SimpleStep>
            )}
          </Card>
        )}

        <FieldEvidence collection={c} role={user?.role ?? ''} />

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Incidents</h2>
            {isDriver && isCollectionActive(c.status) && <Button variant="secondary" onClick={() => setDialog('incident')}>Report incident</Button>}
          </div>
          {c.incidents.length === 0 ? <p className="text-sm text-slate-600">No incidents reported.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {c.incidents.map((i) => (
                <li key={i.id} className="py-3">
                  <p className="font-medium">{INCIDENT_LABELS[i.type]}{i.quantityAffectedKg ? ` · ${formatKg(i.quantityAffectedKg)} affected` : ''}</p>
                  <p>{i.description}</p>
                  <p className="text-xs text-slate-500">{i.by} · {formatDateTime(i.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isManager && canCancelCollection(c.status) && <Button variant="ghost" className="text-red-700" onClick={() => setDialog('cancel')}>Cancel this collection</Button>}
      </div>

      <BookSlotDialog collectionJobId={c.id} open={dialog === 'book'} onClose={() => setDialog(null)} />
      <IncidentDialog collection={c} open={dialog === 'incident'} onClose={() => setDialog(null)} />
      <ReasonDialog open={dialog === 'cancel'} title="Cancel this collection?" description="The request returns to 'Inspection passed' so transport can be assigned again. Not possible after dispatch." label="Reason" confirmLabel="Cancel collection" tone="danger" onClose={() => setDialog(null)} onConfirm={(reason) => cancel.mutateAsync({ reason })} />
    </>
  );
}
