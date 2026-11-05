import { useState } from 'react';
import { useAssignBoth, useAssignees, useAssignInspection, useAssignTransport, useVehicles } from '../features/fieldwork/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatKg } from '../lib/format';
import { localToIso } from '../lib/workflow';
import { Alert, Button, Dialog, SelectField, Spinner, TextField } from './ui';

function firstDetail(err: unknown): string {
  if (err instanceof ApiError && Array.isArray(err.details) && err.details[0]) return err.details[0].message;
  return errorMessage(err);
}

export function AssignInspectionDialog({ requestId, open, onClose }: { requestId: string; open: boolean; onClose: () => void }) {
  const officers = useAssignees('FIELD_OFFICER', open);
  const assign = useAssignInspection(requestId);
  const [officerId, setOfficerId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => { setOfficerId(''); setError(null); onClose(); };
  // Queries are disabled while closed, so their data is undefined; render nothing until opened.
  if (!open) return null;
  const submit = async () => {
    setError(null);
    try {
      await assign.mutateAsync({ officerId });
      close();
    } catch (err) {
      setError(firstDetail(err));
    }
  };

  return (
    <Dialog open={open} title="Assign a field officer" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">The officer will see this farm in their inspection list. Quantity and quality are verified on site; approval alone does not verify them.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {officers.isLoading ? <Spinner /> : officers.isError ? <Alert tone="error">{errorMessage(officers.error)}</Alert> : officers.data!.length === 0 ? (
        <Alert tone="warning">There are no active field officers. Ask an administrator to create one.</Alert>
      ) : (
        <SelectField label="Field officer" value={officerId} onChange={(e) => setOfficerId(e.target.value)} hint="The number in brackets is how many inspections the officer already has open.">
          <option value="">Choose an officer…</option>
          {officers.data!.map((o) => <option key={o.id} value={o.id}>{o.fullName} ({o.activeCount} open)</option>)}
        </SelectField>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!officerId} loading={assign.isPending}>Assign officer</Button>
      </div>
    </Dialog>
  );
}

interface TransportForm { officerId: string; vehicleId: string; pickup: string; eta: string }
const EMPTY_TRANSPORT: TransportForm = { officerId: '', vehicleId: '', pickup: '', eta: '' };

const toTransportInput = (f: TransportForm) => ({
  transportOfficerId: f.officerId,
  vehicleId: f.vehicleId,
  scheduledPickupAt: localToIso(f.pickup),
  expectedArrivalAt: localToIso(f.eta),
});

/** Transport officer, vehicle and schedule fields, shared by the transport-only and the combined dialogs. */
function TransportFields({ form, setForm, enabled }: { form: TransportForm; setForm: (f: TransportForm) => void; enabled: boolean }) {
  const officers = useAssignees('TRANSPORT_OFFICER', enabled);
  const vehicles = useVehicles({ active: 'true', pageSize: 100 }, enabled);
  if (officers.isLoading || vehicles.isLoading) return <Spinner />;
  if (officers.isError || vehicles.isError) return <Alert tone="error">{errorMessage(officers.error ?? vehicles.error)}</Alert>;
  const set = (patch: Partial<TransportForm>) => setForm({ ...form, ...patch });
  return (
    <div className="space-y-4">
      <SelectField label="Transport officer" value={form.officerId} onChange={(e) => set({ officerId: e.target.value })}>
        <option value="">Choose an officer…</option>
        {officers.data!.map((o) => <option key={o.id} value={o.id} disabled={o.activeCount > 0}>{o.fullName}{o.activeCount > 0 ? ' (busy)' : ''}</option>)}
      </SelectField>
      <SelectField label="Vehicle" value={form.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
        <option value="">Choose a vehicle…</option>
        {vehicles.data!.items.map((v) => <option key={v.id} value={v.id} disabled={v.busy}>{v.registrationNumber} · {formatKg(v.capacityKg)}{v.busy ? ' (busy)' : ''}</option>)}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Scheduled pickup (optional)" type="datetime-local" value={form.pickup} onChange={(e) => set({ pickup: e.target.value })} />
        <TextField label="Expected arrival (optional)" type="datetime-local" value={form.eta} onChange={(e) => set({ eta: e.target.value })} hint="Must be set before dispatch" />
      </div>
    </div>
  );
}

export function AssignTransportDialog({ requestId, open, onClose }: { requestId: string; open: boolean; onClose: () => void }) {
  const assign = useAssignTransport(requestId);
  const [form, setForm] = useState<TransportForm>(EMPTY_TRANSPORT);
  const [error, setError] = useState<string | null>(null);

  const close = () => { setForm(EMPTY_TRANSPORT); setError(null); onClose(); };
  if (!open) return null;
  const submit = async () => {
    setError(null);
    try {
      await assign.mutateAsync(toTransportInput(form));
      close();
    } catch (err) {
      setError(firstDetail(err));
    }
  };

  return (
    <Dialog open={open} title="Assign transport" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">Each transport officer and each vehicle can have one active job at a time. Busy ones cannot be chosen.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <TransportFields form={form} setForm={setForm} enabled={open} />
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!form.officerId || !form.vehicleId} loading={assign.isPending}>Assign transport</Button>
      </div>
    </Dialog>
  );
}

/** Assigns the field officer and transport together: transport does not wait for the inspection result. */
export function AssignBothDialog({ requestId, open, onClose }: { requestId: string; open: boolean; onClose: () => void }) {
  const fieldOfficers = useAssignees('FIELD_OFFICER', open);
  const assign = useAssignBoth(requestId);
  const [fieldOfficerId, setFieldOfficerId] = useState('');
  const [form, setForm] = useState<TransportForm>(EMPTY_TRANSPORT);
  const [error, setError] = useState<string | null>(null);

  const close = () => { setFieldOfficerId(''); setForm(EMPTY_TRANSPORT); setError(null); onClose(); };
  if (!open) return null;
  const submit = async () => {
    setError(null);
    try {
      await assign.mutateAsync({ officerId: fieldOfficerId, transport: toTransportInput(form) });
      close();
    } catch (err) {
      setError(firstDetail(err));
    }
  };

  return (
    <Dialog open={open} title="Assign field officer and transport" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">Both are assigned at once. The vehicle can be loaded after the field officer's inspection passes.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="space-y-4">
        {fieldOfficers.isLoading ? <Spinner /> : fieldOfficers.isError ? <Alert tone="error">{errorMessage(fieldOfficers.error)}</Alert> : fieldOfficers.data!.length === 0 ? (
          <Alert tone="warning">There are no active field officers. Ask an administrator to create one.</Alert>
        ) : (
          <SelectField label="Field officer" value={fieldOfficerId} onChange={(e) => setFieldOfficerId(e.target.value)} hint="The number in brackets is how many inspections the officer already has open.">
            <option value="">Choose an officer…</option>
            {fieldOfficers.data!.map((o) => <option key={o.id} value={o.id}>{o.fullName} ({o.activeCount} open)</option>)}
          </SelectField>
        )}
        <TransportFields form={form} setForm={setForm} enabled={open} />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!fieldOfficerId || !form.officerId || !form.vehicleId} loading={assign.isPending}>Assign both</Button>
      </div>
    </Dialog>
  );
}
