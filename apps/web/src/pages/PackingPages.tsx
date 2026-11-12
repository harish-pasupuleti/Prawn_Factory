import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner, TextField } from '../components/ui';
import { useAddBoxes, useApprovePacking, useAssignBoxIds, usePacking, usePackingList, useVoidBox } from '../features/packing/hooks';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatKg } from '../lib/format';
import { BOX_FORM_LABELS, sizeLabel, type PackingRequirement } from '../lib/types';

const requirementLabel = (r: PackingRequirement) => `${BOX_FORM_LABELS[r.form]} · ${sizeLabel(r.sizeGrade)} · ${Number(r.boxWeightKg)} kg boxes`;

export function PackingPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const state = params.get('state') === 'approved' ? 'approved' : params.get('state') === 'open' ? 'open' : undefined;
  const list = usePackingList({ page, state });

  return (
    <div className="space-y-4">
      <PageHeader title="Grading and packing" description="Shipments being processed. Workers separate head-on and headless, grade by size and pack into boxes; the purchase manager numbers and approves the boxes." />
      <div className="flex gap-2 text-sm">
        {([['', 'All'], ['open', 'Open'], ['approved', 'Approved']] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setParams(v ? { state: v } : {})} className={`rounded-full px-3 py-1 ${(state ?? '') === v ? 'bg-teal-700 text-white' : 'bg-slate-200 text-slate-700'}`}>{label}</button>
        ))}
      </div>
      {list.isLoading ? <Spinner /> : list.isError ? <Alert tone="error">{errorMessage(list.error)}</Alert> : list.data!.items.length === 0 ? (
        <EmptyState title="Nothing to pack">Shipments appear here once processing has started.</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 text-sm">
            {list.data!.items.map((i) => (
              <li key={i.shipment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <Link className="font-medium text-teal-800 underline" to={`/packing/${i.shipment.id}`}>{i.shipment.code}</Link> · {i.request.species}
                  <span className="block text-slate-600">
                    {i.stage.hasPlan ? `${i.summary.packedBoxes} of ${i.summary.requiredBoxes} boxes packed · ${i.summary.numberedBoxes} numbered` : 'Waiting for the purchase manager’s box requirements'}
                  </span>
                </span>
                {i.stage.approved ? <Pill tone="green">Approved</Pill> : i.summary.complete ? <Pill tone="blue">Ready to approve</Pill> : <Pill tone="amber">Packing</Pill>}
              </li>
            ))}
          </ul>
          <Pagination page={list.data!.meta.page} totalPages={list.data!.meta.totalPages} total={list.data!.meta.total} onChange={(p) => setParams({ ...(state ? { state } : {}), page: String(p) })} />
        </Card>
      )}
    </div>
  );
}

function RecordBoxes({ shipmentId, requirements }: { shipmentId: string; requirements: PackingRequirement[] }) {
  const add = useAddBoxes(shipmentId);
  const open = requirements.filter((r) => r.remaining > 0);
  const [requirementId, setRequirementId] = useState('');
  const [weight, setWeight] = useState('');
  const [count, setCount] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const chosen = open.find((r) => r.id === requirementId);

  if (open.length === 0) return <Alert tone="success">Every box on the order is packed.</Alert>;
  const invalid = !chosen || !(Number(weight) > 0) || !Number.isInteger(Number(count)) || Number(count) < 1 || Number(count) > chosen.remaining;

  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({ requirementId, netWeightKg: weight.trim(), count: Number(count) });
      setCount('1');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <SelectField label="Box type" value={requirementId} onChange={(e) => { const r = open.find((x) => x.id === e.target.value); setRequirementId(e.target.value); setWeight(r ? String(Number(r.boxWeightKg)) : ''); setCount('1'); }}>
        <option value="">Choose the box you packed…</option>
        {open.map((r) => <option key={r.id} value={r.id}>{requirementLabel(r)} ({r.remaining} still needed)</option>)}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Net weight of each box (kg)" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} hint={chosen ? `Ordered: ${Number(chosen.boxWeightKg)} kg (2% allowed)` : undefined} />
        <TextField label="Number of boxes" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} hint={chosen ? `Up to ${chosen.remaining}` : undefined} />
      </div>
      <Button onClick={() => void submit()} disabled={invalid} loading={add.isPending}>Add boxes</Button>
    </div>
  );
}

export function PackingDetailPage() {
  const { shipmentId = '' } = useParams();
  const { user } = useAuth();
  const q = usePacking(shipmentId);
  const assign = useAssignBoxIds(shipmentId);
  const voidBox = useVoidBox(shipmentId);
  const approve = useApprovePacking(shipmentId);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const d = q.data!;
  const manager = user?.role === 'PURCHASE_MANAGER';
  const operator = user?.role === 'FACTORY_OPERATOR';

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (err) { setError(errorMessage(err)); }
  };
  const incomplete = !d.summary.complete;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Grading and packing · ${d.shipment.code}`}
        description={`${d.request.code} · ${d.request.species} · ${d.request.farmerName}${d.shipment.receivedNetKg ? ` · received ${formatKg(d.shipment.receivedNetKg)}` : ''}`}
        actions={d.stage.approved ? <Pill tone="green">Packing approved</Pill> : <Pill tone="amber">{d.shipment.processing === 'COMPLETED' ? 'Processing completed' : 'Processing'}</Pill>}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {d.stage.approved && <Alert tone="success">Approved on {formatDateTime(d.shipment.packingApprovedAt!)}.{d.shipment.packingNote ? ` Note: ${d.shipment.packingNote}` : ''}</Alert>}
      {!d.stage.hasPlan && (
        <Alert tone="warning">
          The purchase manager has not set the box requirements for this order yet, so boxes cannot be packed.{' '}
          {manager && <Link className="underline" to={`/requests/${d.request.id}`}>Set them on the request.</Link>}
        </Alert>
      )}

      {d.stage.hasPlan && (
        <Card>
          <h2 className="mb-3 text-base font-semibold">Purchase order boxes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Form</th><th className="pr-3">Size grade</th><th className="pr-3">Box weight</th><th className="pr-3">Packed</th><th>Ordered</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.requirements.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3">{BOX_FORM_LABELS[r.form]}</td><td className="pr-3">{sizeLabel(r.sizeGrade)}</td><td className="pr-3">{Number(r.boxWeightKg)} kg</td>
                    <td className="pr-3">{r.packed}{r.remaining === 0 ? ' ✓' : ''}</td><td>{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">{d.summary.packedBoxes} of {d.summary.requiredBoxes} boxes packed · {formatKg(d.summary.packedWeightKg)} packed</p>
        </Card>
      )}

      {operator && d.stage.open && d.stage.hasPlan && <Card><h2 className="mb-3 text-base font-semibold">Record packed boxes</h2><RecordBoxes shipmentId={shipmentId} requirements={d.requirements} /></Card>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Boxes</h2>
          {manager && !d.stage.approved && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void run(() => assign.mutateAsync(undefined))} loading={assign.isPending} disabled={d.summary.unnumberedBoxes === 0}>Assign box numbers ({d.summary.unnumberedBoxes})</Button>
              <Button onClick={() => setApproving(true)} disabled={!d.stage.canApprove || d.summary.unnumberedBoxes > 0 || d.summary.packedBoxes === 0}>Approve packing</Button>
            </div>
          )}
        </div>
        {manager && !d.stage.approved && !d.stage.canApprove && <p className="mb-3 text-sm text-slate-600">Packing can be approved once processing is completed.</p>}
        {d.boxes.length === 0 ? <p className="text-sm text-slate-600">No boxes packed yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Box number</th><th className="pr-3">Form</th><th className="pr-3">Size</th><th className="pr-3">Net weight</th><th className="pr-3">Packed by</th><th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.boxes.map((b) => (
                  <tr key={b.id} className={b.status === 'VOID' ? 'text-slate-400 line-through' : ''}>
                    <td className="py-2 pr-3 font-mono">{b.boxNumber ?? <span className="font-sans text-amber-800 no-underline">Awaiting number</span>}</td>
                    <td className="pr-3">{BOX_FORM_LABELS[b.form]}</td><td className="pr-3">{sizeLabel(b.sizeGrade)}</td><td className="pr-3">{formatKg(b.netWeightKg)}</td><td className="pr-3">{b.packedBy}</td>
                    <td className="text-right">{b.status === 'VOID' ? <span className="text-xs no-underline">Voided: {b.voidReason}</span> : manager && !d.stage.approved && <Button variant="secondary" onClick={() => setVoiding(b.id)}>Void</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReasonDialog open={voiding !== null} title="Void this box" description="A voided box stops counting towards the order and the factory packs a replacement." label="Why is it rejected?" confirmLabel="Void box" tone="danger" onClose={() => setVoiding(null)} onConfirm={async (reason) => { await voidBox.mutateAsync({ boxId: voiding!, reason }); setVoiding(null); }} />
      <ReasonDialog
        open={approving}
        title="Approve packing"
        description={incomplete ? 'The order is not fully packed. Give a note to accept it as it is.' : 'Every box is packed and numbered, and matches the purchase order.'}
        label="Note"
        confirmLabel="Approve"
        required={incomplete}
        onClose={() => setApproving(false)}
        onConfirm={async (note) => { await approve.mutateAsync(note.trim() ? { note: note.trim() } : {}); setApproving(false); }}
      />
    </div>
  );
}
