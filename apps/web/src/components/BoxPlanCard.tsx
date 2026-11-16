import { useEffect, useState } from 'react';
import { useBoxPlan, useSetBoxPlan } from '../features/packing/hooks';
import { errorMessage } from '../lib/errors';
import { BOX_FORM_LABELS, SIZE_GRADES, sizeLabel, type BoxForm } from '../lib/types';
import { Alert, Button, Card, Spinner } from './ui';

interface Draft { form: BoxForm; sizeGrade: string; boxWeightKg: string; quantity: string }
const blank = (): Draft => ({ form: 'HEADLESS', sizeGrade: '20-30', boxWeightKg: '10', quantity: '1' });

/**
 * The purchase order's box requirements: how many boxes of which form, size grade and weight.
 * The factory can only pack what is listed here, so the manager's order is followed.
 */
export function BoxPlanCard({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const plan = useBoxPlan(requestId);
  const save = useSetBoxPlan(requestId);
  const [rows, setRows] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (plan.data) setRows(plan.data.map((l) => ({ form: l.form, sizeGrade: l.sizeGrade, boxWeightKg: String(Number(l.boxWeightKg)), quantity: String(l.quantity) })));
  }, [plan.data]);

  if (plan.isLoading) return <Card><Spinner label="Loading box requirements" /></Card>;
  if (plan.isError) return <Card><Alert tone="error">{errorMessage(plan.error)}</Alert></Card>;

  const set = (i: number, patch: Partial<Draft>) => { setSaved(false); setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r))); };
  const total = rows.reduce((n, r) => n + (Number(r.quantity) || 0), 0);
  const invalid = rows.length === 0 || rows.some((r) => !(Number(r.boxWeightKg) > 0) || !Number.isInteger(Number(r.quantity)) || Number(r.quantity) < 1);

  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync(rows.map((r) => ({ form: r.form, sizeGrade: r.sizeGrade, boxWeightKg: r.boxWeightKg.trim(), quantity: Number(r.quantity) })));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">Box requirements</h2>
      <p className="mb-3 text-sm text-slate-600">{canEdit ? 'Say how the order must be packed. The factory packs only these boxes, and you approve the packing against this list.' : 'How the order must be packed.'}</p>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      {rows.length === 0 && !canEdit && <p className="text-sm text-slate-600">No box requirements have been set yet.</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <label className="text-xs font-medium text-slate-700">Form
              <select disabled={!canEdit} value={r.form} onChange={(e) => set(i, { form: e.target.value as BoxForm })} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm">
                {(Object.keys(BOX_FORM_LABELS) as BoxForm[]).map((f) => <option key={f} value={f}>{BOX_FORM_LABELS[f]}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">Size grade
              <select disabled={!canEdit} value={r.sizeGrade} onChange={(e) => set(i, { sizeGrade: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm">
                {SIZE_GRADES.map((g) => <option key={g} value={g}>{sizeLabel(g)}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">Box weight (kg)
              <input disabled={!canEdit} inputMode="decimal" value={r.boxWeightKg} onChange={(e) => set(i, { boxWeightKg: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-700">Number of boxes
              <input disabled={!canEdit} inputMode="numeric" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-2 text-sm" />
            </label>
            {canEdit && <Button variant="secondary" onClick={() => { setSaved(false); setRows(rows.filter((_, k) => k !== i)); }}>Remove</Button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => { setSaved(false); setRows([...rows, blank()]); }}>Add a line</Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{total} boxes in total</span>
            {saved && <span className="text-sm text-green-700">Saved</span>}
            <Button onClick={() => void submit()} disabled={invalid} loading={save.isPending}>Save requirements</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
