import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AssignInspectionDialog, AssignTransportDialog } from '../components/AssignDialogs';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, PageHeader, Pill, SelectField, Spinner, StatusBadge, TextAreaField, TextField } from '../components/ui';
import { useAmend, useCancel, useDecision, useRequest, useResubmit } from '../features/procurement/hooks';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatFieldValue } from '../lib/format';
import {
  AMENDABLE_FIELDS, FARMER_CANCELLABLE, FIELD_LABELS, INCIDENT_LABELS, OUTCOME_LABELS, QUEUE_STATUS_LABELS, ROLE_LABELS, SHIPMENT_STATUS_LABELS, STAFF_CANCELLABLE, STATUS_LABELS,
  type AmendableField, type ProcurementRequest,
} from '../lib/types';
import { formatKg } from '../lib/format';
import { CollectionStatusPill } from './CollectionPages';
import { InspectionStatusPill } from './InspectionPages';

function AmendDialog({ request, open, onClose }: { request: ProcurementRequest; open: boolean; onClose: () => void }) {
  const amend = useAmend(request.id);
  const [field, setField] = useState<AmendableField>('declaredQuantityKg');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setValue('');
    setReason('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    try {
      await amend.mutateAsync({ field, newValue: value, reason: reason.trim() });
      close();
    } catch (err) {
      const detail = err instanceof ApiError && err.details?.[0]?.message;
      setError(detail || errorMessage(err));
    }
  };

  const inputType = field === 'availabilityDate' ? 'date' : 'text';
  return (
    <Dialog open={open} title="Amend declaration" onClose={close}>
      <p className="mb-4 text-sm text-slate-600">The original declaration is kept. Your change is stored as an amendment with the reason, your name and the time.</p>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className="space-y-4">
        <SelectField
          label="Field to amend"
          value={field}
          onChange={(e) => {
            setField(e.target.value as AmendableField);
            setValue('');
          }}
        >
          {AMENDABLE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {FIELD_LABELS[f]}
            </option>
          ))}
        </SelectField>
        <p className="text-xs text-slate-500">Current value: {formatFieldValue(field, request.current[field])}</p>
        <TextField label="New value" type={inputType} inputMode={field === 'declaredQuantityKg' || field === 'expectedPriceInrPerKg' ? 'decimal' : undefined} value={value} onChange={(e) => setValue(e.target.value)} />
        <TextAreaField label="Reason for the change" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="At least 3 characters" />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close} disabled={amend.isPending}>
          Back
        </Button>
        <Button onClick={() => void submit()} disabled={reason.trim().length < 3 || (field !== 'notes' && value.trim() === '')} loading={amend.isPending}>
          Record amendment
        </Button>
      </div>
    </Dialog>
  );
}

type DialogKind = 'approve' | 'reject' | 'clarify' | 'cancel' | 'resubmit' | 'amend' | 'assignInspection' | 'assignTransport' | null;

function Actions({ request }: { request: ProcurementRequest }) {
  const { user } = useAuth();
  const decision = useDecision(request.id);
  const cancel = useCancel(request.id);
  const resubmit = useResubmit(request.id);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const close = () => setDialog(null);
  if (!user) return null;

  const role = user.role;
  const s = request.status;
  const canDecide = role === 'PURCHASE_MANAGER' && s === 'SUBMITTED';
  const canCancel = role === 'FARMER' ? FARMER_CANCELLABLE.includes(s) : role === 'PURCHASE_MANAGER' && STAFF_CANCELLABLE.includes(s);
  // Sequence: the manager assigns a field officer first; transport is assigned only after the inspection passes.
  const isManager = role === 'PURCHASE_MANAGER';
  const canAssignInspection = isManager && s === 'APPROVED';
  const canAssignTransport = isManager && s === 'INSPECTION_PASSED';
  const decisionInspection = role === 'PURCHASE_MANAGER' && (s === 'INSPECTION_FAILED' || s === 'INSPECTION_REVIEW') ? request.inspections.filter((i) => i.status === 'COMPLETED').at(-1) : undefined;
  const canResubmit = role === 'FARMER' && s === 'CLARIFICATION_REQUESTED';
  // Only the purchase manager changes declared prawn details; farmers reply and resubmit.
  const canAmend = isManager && (s === 'SUBMITTED' || s === 'CLARIFICATION_REQUESTED');

  if (!canDecide && !canCancel && !canResubmit && !canAmend && !canAssignInspection && !canAssignTransport && !decisionInspection) return null;

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold">Actions</h2>
      <div className="flex flex-wrap gap-3">
        {canDecide && (
          <>
            <Button onClick={() => setDialog('approve')}>Approve</Button>
            <Button variant="secondary" onClick={() => setDialog('clarify')}>
              Request clarification
            </Button>
            <Button variant="danger" onClick={() => setDialog('reject')}>
              Reject
            </Button>
          </>
        )}
        {canAssignInspection && <Button onClick={() => setDialog('assignInspection')}>Assign field officer</Button>}
        {canAssignTransport && <Button onClick={() => setDialog('assignTransport')}>Assign transport</Button>}
        {decisionInspection && (
          <Link to={`/inspections/${decisionInspection.id}`} className="inline-flex min-h-10 items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
            Review inspection result
          </Link>
        )}
        {canResubmit && <Button onClick={() => setDialog('resubmit')}>Resubmit for review</Button>}
        {canAmend && (
          <Button variant="secondary" onClick={() => setDialog('amend')}>
            Amend declaration
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" className="text-red-700" onClick={() => setDialog('cancel')}>
            Cancel request
          </Button>
        )}
      </div>

      <ReasonDialog
        open={dialog === 'approve'}
        title="Approve this request?"
        description="Approval accepts the request for the next stage. It does not mean the declared quantity or quality has been verified."
        label="Note (optional)"
        confirmLabel="Approve request"
        required={false}
        onClose={close}
        onConfirm={(note) => decision.mutateAsync({ decision: 'APPROVE', ...(note ? { reason: note } : {}) })}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        title="Reject this request?"
        description="The farmer will see your reason. This cannot be undone."
        label="Reason for rejection"
        confirmLabel="Reject request"
        tone="danger"
        onClose={close}
        onConfirm={(reason) => decision.mutateAsync({ decision: 'REJECT', reason })}
      />
      <ReasonDialog
        open={dialog === 'clarify'}
        title="Request clarification"
        description="The request goes back to the farmer, who replies and resubmits. The purchase manager can amend the declared details."
        label="What needs clarifying?"
        confirmLabel="Send request"
        onClose={close}
        onConfirm={(reason) => decision.mutateAsync({ decision: 'REQUEST_CLARIFICATION', reason })}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        title="Cancel this request?"
        description="Cancelled requests cannot be reopened. Any open inspection or collection job for this request is cancelled too."
        label="Reason for cancellation"
        confirmLabel="Cancel request"
        tone="danger"
        onClose={close}
        onConfirm={(reason) => cancel.mutateAsync({ reason })}
      />
      <ReasonDialog
        open={dialog === 'resubmit'}
        title="Resubmit for review"
        description="Add a short note for the purchase manager about what you clarified or changed."
        label="Note (optional)"
        confirmLabel="Resubmit"
        required={false}
        onClose={close}
        onConfirm={(note) => resubmit.mutateAsync(note ? { note } : {})}
      />
      <AmendDialog request={request} open={dialog === 'amend'} onClose={close} />
      <AssignInspectionDialog requestId={request.id} open={dialog === 'assignInspection'} onClose={close} />
      <AssignTransportDialog requestId={request.id} open={dialog === 'assignTransport'} onClose={close} />
    </Card>
  );
}

interface TimelineItem {
  key: string;
  at: string;
  title: string;
  detail?: string;
}

function buildTimeline(r: ProcurementRequest): TimelineItem[] {
  const items: TimelineItem[] = [{ key: 'created', at: r.createdAt, title: 'Request submitted' }];
  for (const a of r.amendments) {
    items.push({
      key: a.id,
      at: a.at,
      title: `${FIELD_LABELS[a.field as AmendableField] ?? a.field} amended by ${a.by} (${ROLE_LABELS[a.byRole]})`,
      detail: `${formatFieldValue(a.field, a.oldValue)} → ${formatFieldValue(a.field, a.newValue)}. Reason: ${a.reason}`,
    });
  }
  if (r.lastStatusChange) {
    const by = r.lastStatusChange.by ? ` by ${r.lastStatusChange.by}` : '';
    items.push({
      key: 'status',
      at: r.lastStatusChange.at,
      title: `Latest status change: ${STATUS_LABELS[r.status]}${by}`,
      ...(r.lastStatusChange.reason ? { detail: r.lastStatusChange.reason } : {}),
    });
  }
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function RequestDetailPage() {
  const { id } = useParams();
  const { data: request, isLoading, isError, error } = useRequest(id);

  if (isLoading) return <Spinner label="Loading request" />;
  if (isError || !request) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <>
        <Alert tone="error">{notFound ? 'This request does not exist or you do not have access to it.' : errorMessage(error, 'Could not load the request.')}</Alert>
        <p className="mt-4">
          <Link to="/requests" className="font-medium text-teal-800 underline">
            Back to requests
          </Link>
        </p>
      </>
    );
  }

  const staff = Boolean(request.farmer);
  const timeline = buildTimeline(request);
  return (
    <>
      <PageHeader title={request.code} description={`Submitted ${formatDateTime(request.createdAt)}`} actions={<StatusBadge status={request.status} />} />
      <div className="space-y-6">
        {request.status === 'APPROVED' && <Alert tone="warning">Approved for the next stage. The declared quantity and quality have not been verified yet.</Alert>}
        {request.status === 'CLARIFICATION_REQUESTED' && request.lastStatusChange?.reason && (
          <Alert tone="warning">Clarification requested: {request.lastStatusChange.reason}</Alert>
        )}
        {request.status === 'REJECTED' && request.lastStatusChange?.reason && <Alert tone="error">Rejected: {request.lastStatusChange.reason}</Alert>}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-base font-semibold">Declaration</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              {AMENDABLE_FIELDS.map((f) => {
                const changed = request.current[f] !== request.original[f];
                return (
                  <div key={f} className="grid gap-1 py-3 sm:grid-cols-3">
                    <dt className="font-medium text-slate-600">{FIELD_LABELS[f]}</dt>
                    <dd className="sm:col-span-2">
                      <span>{formatFieldValue(f, request.current[f])}</span>
                      {changed && <span className="ml-2 text-xs text-amber-800">(amended; originally {formatFieldValue(f, request.original[f])})</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>

          {request.farmer && (
            <Card>
              <h2 className="mb-3 text-base font-semibold">Farmer</h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">{request.farmer.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Mobile</dt>
                  <dd>{request.farmer.phone}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Location</dt>
                  <dd>
                    {request.farmer.village}, {request.farmer.district}, {request.farmer.state}
                  </dd>
                </div>
              </dl>
            </Card>
          )}
        </div>

        <Actions request={request} />

        {request.inspections.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Field inspection</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {request.inspections.map((i) => (
                <li key={i.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <InspectionStatusPill inspection={i} />
                    <span className="font-medium">{i.officerName}</span>
                    {i.completedAt && <span className="text-xs text-slate-500">{formatDateTime(i.completedAt)}</span>}
                    {staff && <Link to={`/inspections/${i.id}`} className="ml-auto text-xs font-medium text-teal-800 underline">Open</Link>}
                  </div>
                  {i.status === 'COMPLETED' && (
                    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                      <div><dt className="inline text-slate-500">Outcome: </dt><dd className="inline font-medium">{i.outcome ? OUTCOME_LABELS[i.outcome] : '—'}</dd></div>
                      <div><dt className="inline text-slate-500">Inspected quantity: </dt><dd className="inline font-medium">{i.inspectedQuantityKg ? formatKg(i.inspectedQuantityKg) : '—'}</dd></div>
                      <div><dt className="inline text-slate-500">Observed: </dt><dd className="inline">{i.observedSpecies} · {i.observedSizeCount}</dd></div>
                      {i.quantityVariancePct && <div><dt className="inline text-slate-500">Difference from declaration: </dt><dd className="inline">{i.quantityVariancePct}%</dd></div>}
                      <div className="sm:col-span-2"><dt className="inline text-slate-500">Quality: </dt><dd className="inline">{i.qualityNotes}</dd></div>
                      {i.discrepancyNotes && <div className="sm:col-span-2"><dt className="inline text-slate-500">Discrepancy: </dt><dd className="inline">{i.discrepancyNotes}</dd></div>}
                    </dl>
                  )}
                  {i.decision && <p className="mt-2 text-xs text-slate-600">Manager decision ({i.decision.by}): {i.decision.kind.toLowerCase()} · {i.decision.reason}</p>}
                  {i.cancelReason && <p className="mt-2 text-xs text-slate-600">Cancelled: {i.cancelReason}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {request.shipments.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">At the factory</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {request.shipments.map((sh) => (
                <li key={sh.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="font-medium">{sh.code}</span>
                  <Pill tone={sh.status === 'RELEASED' ? 'green' : sh.status === 'RECEIVED' ? 'blue' : 'slate'}>{SHIPMENT_STATUS_LABELS[sh.status]}</Pill>
                  {sh.receivedQuantityKg && <span>Received <strong>{formatKg(sh.receivedQuantityKg)}</strong>{sh.receivedAt ? ` on ${formatDateTime(sh.receivedAt)}` : ''}</span>}
                  {staff && sh.openExceptions && sh.openExceptions.length > 0 && <Pill tone="red">Open exception</Pill>}
                  {staff && sh.queueStatus && <Pill tone="violet">Queue: {QUEUE_STATUS_LABELS[sh.queueStatus]}</Pill>}
                  {staff && <Link to={`/shipments/${sh.id}`} className="ml-auto text-xs font-medium text-teal-800 underline">Open</Link>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {request.collections.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">Transport and collection</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {request.collections.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CollectionStatusPill collection={c} />
                    <span className="font-medium">{c.vehicleRegistration}</span>
                    <span className="text-slate-600">driver {c.officerName}</span>
                    {staff && <Link to={`/collections/${c.id}`} className="ml-auto text-xs font-medium text-teal-800 underline">Open</Link>}
                  </div>
                  <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                    {c.scheduledPickupAt && <div><dt className="inline text-slate-500">Pickup scheduled: </dt><dd className="inline">{formatDateTime(c.scheduledPickupAt)}</dd></div>}
                    {c.expectedArrivalAt && <div><dt className="inline text-slate-500">Expected arrival: </dt><dd className="inline">{formatDateTime(c.expectedArrivalAt)}</dd></div>}
                    {c.collectedQuantityKg && <div><dt className="inline text-slate-500">Collected: </dt><dd className="inline font-medium">{formatKg(c.collectedQuantityKg)}</dd></div>}
                    {c.arrivedAt && <div><dt className="inline text-slate-500">Arrived: </dt><dd className="inline">{formatDateTime(c.arrivedAt)}</dd></div>}
                    {c.handedOverAt && <div><dt className="inline text-slate-500">Handed over: </dt><dd className="inline">{formatDateTime(c.handedOverAt)}</dd></div>}
                  </dl>
                  {staff && c.incidents && c.incidents.length > 0 && (
                    <p className="mt-2 text-xs text-slate-600">
                      <Pill tone="amber">{c.incidents.length} incident{c.incidents.length > 1 ? 's' : ''}</Pill>{' '}
                      {c.incidents.map((i) => INCIDENT_LABELS[i.type]).join(', ')}
                    </p>
                  )}
                  {staff && c.cancelReason && <p className="mt-2 text-xs text-slate-600">Cancelled: {c.cancelReason}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="mb-1 text-base font-semibold">Timeline</h2>
          <p className="mb-4 text-xs text-slate-500">Built from stored records. Only the latest status change is kept on the request; the full history is in the administrator audit log.</p>
          <ol className="space-y-4 border-l-2 border-slate-200 pl-5">
            {timeline.map((item) => (
              <li key={item.key} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-1.5 size-3 rounded-full bg-teal-700 ring-4 ring-white" />
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-slate-500">{formatDateTime(item.at)}</p>
                {item.detail && <p className="mt-1 text-sm text-slate-700">{item.detail}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
