import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner, TextField } from '../components/ui';
import {
  useCorrectWeight, useRecordWeight, useReceiveShipment, useReleaseShipment, useShipment, useShipments,
} from '../features/factory/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatKg } from '../lib/format';
import { SHIPMENT_STATUS_LABELS, type Shipment, type ShipmentStatus } from '../lib/types';

export function ShipmentPill({ shipment }: { shipment: Pick<Shipment, 'status' | 'hasOpenDiscrepancy' | 'waitingForHandover'> }) {
  const tone = shipment.status === 'RELEASED' ? 'green' : shipment.status === 'RECEIVED' ? 'blue' : shipment.status === 'ADMITTED' ? 'violet' : 'slate';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Pill tone={tone}>{SHIPMENT_STATUS_LABELS[shipment.status]}</Pill>
      {shipment.hasOpenDiscrepancy && <Pill tone="red">Discrepancy</Pill>}
      {shipment.waitingForHandover && <Pill tone="amber">Waiting for handover</Pill>}
    </span>
  );
}

const STATUSES: ShipmentStatus[] = ['EXPECTED', 'ADMITTED', 'RECEIVED', 'RELEASED'];

export function ShipmentsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status = (STATUSES as string[]).includes(statusParam ?? '') ? (statusParam as ShipmentStatus) : '';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const result = useShipments({ page, pageSize: 10, status, q });

  const update = (patch: Record<string, string | undefined>, reset = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (reset) next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Shipments" description="Consignments booked for, or received at, the factory." />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() || undefined }); }}>
          <TextField label="Shipment code" placeholder="SH-2026-000001" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectField label="Status" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS_LABELS[s]}</option>)}
          </SelectField>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </Card>
      {result.isLoading ? <Spinner label="Loading shipments" /> : result.isError ? <Alert tone="error">{errorMessage(result.error)}</Alert> : result.data!.items.length === 0 ? (
        <EmptyState title="No shipments match" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Shipments</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr><th scope="col" className="px-4 py-3">Shipment</th><th scope="col" className="px-4 py-3">Vehicle</th><th scope="col" className="px-4 py-3">Species</th><th scope="col" className="px-4 py-3 text-right">Net weight</th><th scope="col" className="px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3"><Link to={`/shipments/${s.id}`} className="font-medium text-teal-800 underline">{s.code}</Link></td>
                    <td className="px-4 py-3">{s.vehicleRegistration}</td>
                    <td className="px-4 py-3">{s.species}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{s.weights.netKg ? formatKg(s.weights.netKg) : '—'}</td>
                    <td className="px-4 py-3"><ShipmentPill shipment={s} /></td>
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

const WEIGHT_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

/** One weight entry: validates before sending so factory staff get an immediate message. */
function WeightEntry({ shipment, kind }: { shipment: Shipment; kind: 'GROSS' | 'TARE' }) {
  const record = useRecordWeight(shipment.id);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const label = kind === 'GROSS' ? 'Gross weight (kg) — vehicle with load' : 'Tare weight (kg) — empty vehicle';

  const submit = async () => {
    setError(undefined);
    if (!WEIGHT_PATTERN.test(value.trim())) return setError('Enter a number with at most 3 decimal places');
    if (kind === 'GROSS' && !/[1-9]/.test(value)) return setError('Gross weight must be greater than zero');
    try {
      await record.mutateAsync({ kind, valueKg: value.trim() });
      setValue('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    }
  };
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1"><TextField label={label} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} error={error} /></div>
      <Button onClick={() => void submit()} loading={record.isPending}>Record {kind === 'GROSS' ? 'gross' : 'tare'}</Button>
    </div>
  );
}

function CorrectDialog({ shipment, open, onClose }: { shipment: Shipment; open: boolean; onClose: () => void }) {
  const correct = useCorrectWeight(shipment.id);
  const [kind, setKind] = useState<'GROSS' | 'TARE'>('GROSS');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const close = () => { setValue(''); setReason(''); setError(null); onClose(); };
  const current = kind === 'GROSS' ? shipment.weights.gross : shipment.weights.tare;
  const submit = async () => {
    setError(null);
    try {
      await correct.mutateAsync({ kind, valueKg: value.trim(), reason: reason.trim() });
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    }
  };
  return (
    <Dialog open title="Correct a weight" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">The original value stays on record together with your reason, your name and the time.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="space-y-4">
        <SelectField label="Which weight?" value={kind} onChange={(e) => setKind(e.target.value as 'GROSS' | 'TARE')}>
          <option value="GROSS" disabled={!shipment.weights.gross}>Gross</option>
          <option value="TARE" disabled={!shipment.weights.tare}>Tare</option>
        </SelectField>
        <p className="text-xs text-slate-500">Current value: {current ? formatKg(current.valueKg) : 'not recorded'}</p>
        <TextField label="Corrected value (kg)" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <label className="block text-sm font-medium text-slate-800">Reason for the correction
          <textarea className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!WEIGHT_PATTERN.test(value.trim()) || reason.trim().length < 3 || !current} loading={correct.isPending}>Record correction</Button>
      </div>
    </Dialog>
  );
}

type Dlg = 'receive' | 'release' | 'correct' | null;

export function ShipmentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: s, isLoading, isError, error } = useShipment(id);
  const receive = useReceiveShipment(id ?? '');
  const release = useReleaseShipment(id ?? '');
  const [dlg, setDlg] = useState<Dlg>(null);
  if (isLoading) return <Spinner label="Loading shipment" />;
  if (isError || !s) return <Alert tone="error">{error instanceof ApiError && error.status === 404 ? 'Shipment not found.' : errorMessage(error)}</Alert>;
  const manager = user?.role === 'PURCHASE_MANAGER' || user?.role === 'ADMIN';
  const close = () => setDlg(null);

  return (
    <>
      <PageHeader title={`Shipment · ${s.code}`} description={`${s.vehicleRegistration} · driver ${s.driverName} · ${s.species} ${s.declaredSizeCount}`} actions={<ShipmentPill shipment={s} />} />
      <div className="space-y-6">
        {s.waitingForHandover && <Alert tone="info">Both weights are recorded. Reception can be completed once the driver has recorded the handover.</Alert>}
        {s.hasOpenDiscrepancy && (
          <Alert tone="warning">The received weight differs from what was collected. A purchase manager must resolve this before the shipment can go to processing.{manager && <> <Link className="font-medium underline" to="/exceptions?status=OPEN">Open exceptions</Link></>}</Alert>
        )}

        <Card>
          <h2 className="mb-3 text-base font-semibold">Weighing</h2>
          <dl className="grid gap-4 sm:grid-cols-3 text-sm">
            <div><dt className="text-slate-500">Gross (loaded)</dt><dd className="text-lg font-semibold">{s.weights.gross ? formatKg(s.weights.gross.valueKg) : '—'}</dd>{s.weights.gross?.corrected && <Pill tone="amber">Corrected</Pill>}</div>
            <div><dt className="text-slate-500">Tare (empty)</dt><dd className="text-lg font-semibold">{s.weights.tare ? formatKg(s.weights.tare.valueKg) : '—'}</dd>{s.weights.tare?.corrected && <Pill tone="amber">Corrected</Pill>}</div>
            <div><dt className="text-slate-500">Net (gross − tare)</dt><dd className="text-lg font-semibold text-teal-800">{s.weights.netKg ? formatKg(s.weights.netKg) : '—'}</dd></div>
          </dl>
          {(s.can.recordGross || s.can.recordTare) && (
            <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
              {s.can.recordGross && <WeightEntry shipment={s} kind="GROSS" />}
              {s.can.recordTare && <WeightEntry shipment={s} kind="TARE" />}
            </div>
          )}
          {s.status === 'EXPECTED' && <p className="mt-4 text-sm text-slate-600">The vehicle has not been admitted at the gate yet.</p>}
          {user?.role === 'PURCHASE_MANAGER' && s.can.correct && <div className="mt-4"><Button variant="secondary" onClick={() => setDlg('correct')}>Correct a weight</Button></div>}
        </Card>

        {manager && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Comparison with earlier measurements</h2>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-slate-500">Collected at the farm</dt><dd className="font-semibold">{s.collectedQuantityKg ? formatKg(s.collectedQuantityKg) : '—'}</dd></div>
              <div><dt className="text-slate-500">Received (net)</dt><dd className="font-semibold">{s.receivedQuantityKg ? formatKg(s.receivedQuantityKg) : '—'}</dd></div>
              <div><dt className="text-slate-500">Difference (limit {s.thresholdPct}%)</dt><dd className="font-semibold">{s.variancePct ? `${s.variancePct}%` : '—'}</dd></div>
            </dl>
          </Card>
        )}

        {(s.can.receive || s.can.release || s.status === 'RECEIVED' || s.status === 'RELEASED') && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Reception</h2>
            {s.status === 'RECEIVED' || s.status === 'RELEASED' ? <p className="mb-3 text-sm">Received {s.receivedAt ? formatDateTime(s.receivedAt) : ''}: <strong>{s.receivedQuantityKg ? formatKg(s.receivedQuantityKg) : '—'}</strong></p> : null}
            <div className="flex flex-wrap gap-3">
              {s.can.receive && <Button onClick={() => setDlg('receive')}>Complete reception</Button>}
              {s.can.release && <Button onClick={() => setDlg('release')}>Release to processing</Button>}
              {s.status === 'RELEASED' && s.queue && <Link to="/queue" className="inline-flex min-h-10 items-center text-sm font-medium text-teal-800 underline">View in processing queue</Link>}
            </div>
          </Card>
        )}

        {manager && s.history && s.history.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Measurement history</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Every weight recorded, including corrected values</caption>
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600"><tr><th scope="col" className="py-2 pr-4">When</th><th scope="col" className="py-2 pr-4">Weight</th><th scope="col" className="py-2 pr-4 text-right">Value</th><th scope="col" className="py-2 pr-4">By</th><th scope="col" className="py-2">Reason</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {s.history.map((h) => (
                    <tr key={h.id}><td className="whitespace-nowrap py-2 pr-4">{formatDateTime(h.at)}</td><td className="py-2 pr-4">{h.kind === 'GROSS' ? 'Gross' : 'Tare'}{h.supersedesId ? ' (correction)' : ''}</td><td className="whitespace-nowrap py-2 pr-4 text-right">{formatKg(h.valueKg)}</td><td className="py-2 pr-4">{h.by}</td><td className="py-2">{h.reason ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <CorrectDialog shipment={s} open={dlg === 'correct'} onClose={close} />
      <ReasonDialog open={dlg === 'receive'} title="Complete reception?" description={`The net weight of ${s.weights.netKg ? formatKg(s.weights.netKg) : ''} becomes the received quantity. Weights can then only be changed by a purchase manager, with a reason.`} label="Note (optional)" confirmLabel="Complete reception" required={false} onClose={close} onConfirm={() => receive.mutateAsync(undefined)} />
      <ReasonDialog open={dlg === 'release'} title="Release to processing?" description="The shipment joins the processing queue. Its target processing time is set from the received weight." label="Note (optional)" confirmLabel="Release to processing" required={false} onClose={close} onConfirm={() => release.mutateAsync(undefined)} />
    </>
  );
}
