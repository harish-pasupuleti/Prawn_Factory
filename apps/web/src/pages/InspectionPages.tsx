import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner, TextAreaField, TextField } from '../components/ui';
import {
  useCancelInspection, useCompleteInspection, useDecideInspection, useInspection, useInspections, useStartInspection, type InspectionFindings,
} from '../features/fieldwork/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatKg } from '../lib/format';
import {
  INSPECTION_STATUS_LABELS, OUTCOME_LABELS, STATUS_LABELS, type Inspection, type InspectionOutcome, type InspectionStatus,
} from '../lib/types';
import { canCancelInspection, variancePercent } from '../lib/workflow';

export function InspectionStatusPill({ inspection }: { inspection: Pick<Inspection, 'status' | 'outcome'> }) {
  if (inspection.status === 'COMPLETED' && inspection.outcome) {
    const tone = inspection.outcome === 'PASS' ? 'green' : inspection.outcome === 'FAIL' ? 'red' : 'amber';
    return <Pill tone={tone}>{OUTCOME_LABELS[inspection.outcome]}</Pill>;
  }
  const tone = inspection.status === 'IN_PROGRESS' ? 'blue' : inspection.status === 'CANCELLED' ? 'slate' : 'violet';
  return <Pill tone={tone}>{INSPECTION_STATUS_LABELS[inspection.status]}</Pill>;
}

const STATUSES: InspectionStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export function InspectionsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status = (STATUSES as string[]).includes(statusParam ?? '') ? (statusParam as InspectionStatus) : '';
  const outcomeParam = params.get('outcome');
  const outcome = ['PASS', 'FAIL', 'REVIEW'].includes(outcomeParam ?? '') ? (outcomeParam as InspectionOutcome) : '';
  const result = useInspections({ page, pageSize: 10, status, outcome });
  const mine = user?.role === 'FIELD_OFFICER';

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (resetPage) next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader title={mine ? 'My inspections' : 'Field inspections'} description={mine ? 'Farms assigned to you for inspection.' : 'All inspection assignments and outcomes.'} />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Status" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{INSPECTION_STATUS_LABELS[s]}</option>
            ))}
          </SelectField>
          <SelectField label="Outcome" value={outcome} onChange={(e) => update({ outcome: e.target.value || undefined })}>
            <option value="">Any outcome</option>
            {(['PASS', 'FAIL', 'REVIEW'] as const).map((o) => (
              <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
            ))}
          </SelectField>
        </div>
      </Card>

      {result.isLoading ? (
        <Spinner label="Loading inspections" />
      ) : result.isError ? (
        <Alert tone="error">{errorMessage(result.error, 'Could not load inspections.')}</Alert>
      ) : result.data!.items.length === 0 ? (
        <EmptyState title="No inspections match">{mine ? 'New assignments will appear here.' : 'Assign a field officer from an approved request.'}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Field inspections</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Request</th>
                  <th scope="col" className="px-4 py-3">Farmer / location</th>
                  <th scope="col" className="px-4 py-3">Species</th>
                  <th scope="col" className="px-4 py-3 text-right">Declared</th>
                  {!mine && <th scope="col" className="px-4 py-3">Officer</th>}
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/inspections/${i.id}`} className="font-medium text-teal-800 underline">{i.request.code}</Link>
                    </td>
                    <td className="px-4 py-3">{i.request.farmer.name}<span className="block text-xs text-slate-500">{i.request.farmer.village}, {i.request.farmer.district}</span></td>
                    <td className="px-4 py-3">{i.request.declaration.species}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{formatKg(i.request.declaration.declaredQuantityKg)}</td>
                    {!mine && <td className="px-4 py-3">{i.officer.name}</td>}
                    <td className="px-4 py-3"><InspectionStatusPill inspection={i} /></td>
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

// ------------------------------------------------------------------ findings form
export const findingsSchema = z.object({
  outcome: z.enum(['PASS', 'FAIL', 'REVIEW']),
  observedSpecies: z.string().trim().min(2, 'Observed species is required').max(80),
  observedSizeCount: z.string().trim().min(1, 'Observed size or count is required').max(60),
  inspectedQuantityKg: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Quantity must be a number with at most 3 decimal places'),
  qualityNotes: z.string().trim().min(3, 'Quality observations are required').max(1000),
  discrepancyNotes: z.string().trim().max(1000).optional(),
}).superRefine((v, ctx) => {
  if (v.outcome !== 'FAIL' && !/[1-9]/.test(v.inspectedQuantityKg)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inspectedQuantityKg'], message: 'Quantity must be greater than zero for a pass or review' });
  }
});
type FindingsValues = z.infer<typeof findingsSchema>;

function FindingsForm({ inspection }: { inspection: Inspection }) {
  const complete = useCompleteInspection(inspection.id);
  const [pending, setPending] = useState<FindingsValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register, handleSubmit, watch, setError: setFieldError, formState: { errors },
  } = useForm<FindingsValues>({
    resolver: zodResolver(findingsSchema),
    defaultValues: {
      outcome: 'PASS',
      observedSpecies: inspection.request.declaration.species,
      observedSizeCount: inspection.request.declaration.declaredSizeCount,
      qualityNotes: '',
      discrepancyNotes: '',
    },
  });

  const declared = inspection.request.declaration.declaredQuantityKg;
  const typedQuantity = watch('inspectedQuantityKg');
  const gap = typedQuantity && /^\d+(\.\d+)?$/.test(typedQuantity) ? variancePercent(declared, typedQuantity) : null;

  const submit = async () => {
    if (!pending) return;
    setError(null);
    const payload: InspectionFindings = { ...pending, ...(pending.discrepancyNotes ? { discrepancyNotes: pending.discrepancyNotes } : {}) };
    if (!pending.discrepancyNotes) delete payload.discrepancyNotes;
    try {
      await complete.mutateAsync(payload);
      setPending(null);
    } catch (err) {
      setPending(null);
      if (err instanceof ApiError && err.code === 'DISCREPANCY_NOTES_REQUIRED') {
        setFieldError('discrepancyNotes', { type: 'server', message: err.message });
      } else {
        setError(errorMessage(err, 'Could not save the findings.'));
      }
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">Record findings</h2>
      <p className="mb-4 text-sm text-slate-600">Declared by the farmer: <strong>{formatKg(declared)}</strong>. Your measurements are stored separately and never replace the declaration.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <form onSubmit={handleSubmit((v) => setPending(v))} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Outcome" error={errors.outcome?.message} {...register('outcome')}>
            <option value="PASS">Pass</option>
            <option value="REVIEW">Needs manager review</option>
            <option value="FAIL">Fail</option>
          </SelectField>
          <TextField label="Inspected quantity (kg)" inputMode="decimal" hint={gap !== null ? `${gap.toFixed(1)}% different from the declared quantity` : 'Up to 3 decimal places'} error={errors.inspectedQuantityKg?.message} {...register('inspectedQuantityKg')} />
          <TextField label="Observed species" error={errors.observedSpecies?.message} {...register('observedSpecies')} />
          <TextField label="Observed size / count" error={errors.observedSizeCount?.message} {...register('observedSizeCount')} />
        </div>
        <TextAreaField label="Quality observations" rows={3} error={errors.qualityNotes?.message} {...register('qualityNotes')} />
        <TextAreaField label="Discrepancy notes" rows={2} hint="Required to pass when the findings differ from the declaration." error={errors.discrepancyNotes?.message} {...register('discrepancyNotes')} />
        <Button type="submit">Review and submit</Button>
      </form>

      <Dialog open={pending !== null} title="Submit these findings?" onClose={() => setPending(null)}>
        {pending && (
          <>
            <dl className="mb-4 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Outcome</dt><dd className="font-medium">{OUTCOME_LABELS[pending.outcome]}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Quantity</dt><dd className="font-medium">{formatKg(pending.inspectedQuantityKg)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Species</dt><dd className="font-medium">{pending.observedSpecies}</dd></div>
            </dl>
            <p className="mb-4 text-sm text-slate-600">Findings cannot be edited after submission.{pending.outcome !== 'PASS' && ' A manager must decide before this request can continue.'}</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPending(null)}>Back</Button>
              <Button onClick={() => void submit()} loading={complete.isPending}>Submit findings</Button>
            </div>
          </>
        )}
      </Dialog>
    </Card>
  );
}

// ------------------------------------------------------------------ detail
type DialogKind = 'proceed' | 'reject' | 'reinspect' | 'cancel' | null;

export function InspectionDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: inspection, isLoading, isError, error } = useInspection(id);
  const start = useStartInspection(id ?? '');
  const decide = useDecideInspection(id ?? '');
  const cancel = useCancelInspection(id ?? '');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [startError, setStartError] = useState<string | null>(null);

  if (isLoading) return <Spinner label="Loading inspection" />;
  if (isError || !inspection) {
    const missing = error instanceof ApiError && error.status === 404;
    return <Alert tone="error">{missing ? 'This inspection does not exist or is not assigned to you.' : errorMessage(error)}</Alert>;
  }

  const isOfficer = user?.role === 'FIELD_OFFICER';
  const isManager = user?.role === 'PURCHASE_MANAGER';
  const d = inspection.request.declaration;
  const needsDecision =
    isManager && inspection.status === 'COMPLETED' && (inspection.outcome === 'FAIL' || inspection.outcome === 'REVIEW') && !inspection.decision &&
    (inspection.request.status === 'INSPECTION_FAILED' || inspection.request.status === 'INSPECTION_REVIEW');
  const close = () => setDialog(null);

  return (
    <>
      <PageHeader
        title={`Inspection · ${inspection.request.code}`}
        description={`Assigned ${formatDateTime(inspection.assignedAt)} to ${inspection.officer.name}`}
        actions={<InspectionStatusPill inspection={inspection} />}
      />
      <div className="space-y-6">
        <p className="text-sm text-slate-600">Request status: <strong>{STATUS_LABELS[inspection.request.status]}</strong>
          {!isOfficer && <> · <Link className="font-medium text-teal-800 underline" to={`/requests/${inspection.request.id}`}>Open request</Link></>}
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-base font-semibold">Farmer declaration</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              {[['Species', d.species], ['Size / count', d.declaredSizeCount], ['Quantity', formatKg(d.declaredQuantityKg)], ['Available from', formatDate(d.availabilityDate)], ['Notes', d.notes || '—']].map(([k, v]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium text-slate-600">{k}</dt><dd className="sm:col-span-2">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 text-base font-semibold">Farm visit</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-500">Farmer</dt><dd className="font-medium">{inspection.request.farmer.name}</dd></div>
              <div><dt className="text-slate-500">Mobile</dt><dd>{inspection.request.farmer.phone}</dd></div>
              <div><dt className="text-slate-500">Location</dt><dd>{inspection.request.farmer.village}, {inspection.request.farmer.district}, {inspection.request.farmer.state}</dd></div>
            </dl>
          </Card>
        </div>

        {isOfficer && inspection.status === 'ASSIGNED' && (
          <Card>
            <h2 className="mb-2 text-base font-semibold">Start the inspection</h2>
            <p className="mb-4 text-sm text-slate-600">Starting records the time at the server. Do this when you reach the farm.</p>
            {startError && <div className="mb-3"><Alert tone="error">{startError}</Alert></div>}
            <Button loading={start.isPending} onClick={() => { setStartError(null); start.mutate(undefined, { onError: (e) => setStartError(errorMessage(e)) }); }}>Start inspection</Button>
          </Card>
        )}

        {isOfficer && inspection.status === 'IN_PROGRESS' && <FindingsForm inspection={inspection} />}

        {inspection.status === 'COMPLETED' && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Findings</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                ['Outcome', inspection.outcome ? OUTCOME_LABELS[inspection.outcome] : '—'],
                ['Inspected quantity', inspection.inspectedQuantityKg ? formatKg(inspection.inspectedQuantityKg) : '—'],
                ['Declared at the time', inspection.declaredQuantityKgAtInspection ? formatKg(inspection.declaredQuantityKgAtInspection) : '—'],
                ['Difference', inspection.quantityVariancePct ? `${inspection.quantityVariancePct}%` : '—'],
                ['Observed species', inspection.observedSpecies ?? '—'],
                ['Observed size / count', inspection.observedSizeCount ?? '—'],
                ['Quality observations', inspection.qualityNotes ?? '—'],
                ['Discrepancy notes', inspection.discrepancyNotes || '—'],
                ['Completed', inspection.completedAt ? formatDateTime(inspection.completedAt) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-3"><dt className="font-medium text-slate-600">{k}</dt><dd className="sm:col-span-2">{v}</dd></div>
              ))}
            </dl>
          </Card>
        )}

        {inspection.decision && (
          <Alert tone="info">
            Manager decision by {inspection.decision.by} on {formatDateTime(inspection.decision.at)}: <strong>{{ PROCEED: 'Proceed with exception', REJECT: 'Reject request', REINSPECT: 'Re-inspect' }[inspection.decision.kind]}</strong>. Reason: {inspection.decision.reason}
          </Alert>
        )}
        {inspection.status === 'CANCELLED' && <Alert tone="warning">This assignment was cancelled{inspection.cancelReason ? `: ${inspection.cancelReason}` : '.'}</Alert>}

        {needsDecision && (
          <Card>
            <h2 className="mb-2 text-base font-semibold">Decision required</h2>
            <p className="mb-4 text-sm text-slate-600">This inspection {inspection.outcome === 'FAIL' ? 'failed' : 'needs review'}. The request cannot go to transport until you decide. Your decision and reason are recorded permanently.</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setDialog('proceed')}>Proceed with exception</Button>
              <Button variant="secondary" onClick={() => setDialog('reinspect')}>Re-inspect</Button>
              <Button variant="danger" onClick={() => setDialog('reject')}>Reject request</Button>
            </div>
          </Card>
        )}

        {isManager && canCancelInspection(inspection.status) && (
          <Button variant="ghost" className="text-red-700" onClick={() => setDialog('cancel')}>Cancel this assignment</Button>
        )}
      </div>

      <ReasonDialog open={dialog === 'proceed'} title="Proceed despite the inspection result?" description="This is an exception. The request will continue to transport as if it had passed. The reason is stored with your name." label="Reason for the exception" confirmLabel="Proceed with exception" onClose={close} onConfirm={(reason) => decide.mutateAsync({ decision: 'PROCEED', reason })} />
      <ReasonDialog open={dialog === 'reinspect'} title="Request a new inspection?" description="The request returns to Approved so you can assign a field officer again." label="Reason for re-inspection" confirmLabel="Re-inspect" onClose={close} onConfirm={(reason) => decide.mutateAsync({ decision: 'REINSPECT', reason })} />
      <ReasonDialog open={dialog === 'reject'} title="Reject this request?" description="The farmer will see your reason. This cannot be undone." label="Reason for rejection" confirmLabel="Reject request" tone="danger" onClose={close} onConfirm={(reason) => decide.mutateAsync({ decision: 'REJECT', reason })} />
      <ReasonDialog open={dialog === 'cancel'} title="Cancel this assignment?" description="The request returns to Approved and the officer will no longer see it." label="Reason" confirmLabel="Cancel assignment" tone="danger" onClose={close} onConfirm={(reason) => cancel.mutateAsync({ reason })} />
    </>
  );
}
