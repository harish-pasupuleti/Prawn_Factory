import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ReasonDialog } from '../components/ReasonDialog';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner } from '../components/ui';
import { useCompleteProcessing, useQueue, useStartProcessing, useStations, useTicker } from '../features/factory/hooks';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatKg } from '../lib/format';
import { clockOffsetMs, formatDuration, liveTimer } from '../lib/timers';
import { QUEUE_STATUS_LABELS, type QueueEntry, type QueueStatus, type Timer } from '../lib/types';

/** Shows the timer for an entry. The numbers come from stored server times, so a refresh shows the same countdown. */
export function TimerCell({ timer }: { timer: Timer }) {
  if (timer.state === 'NOT_STARTED') return <span className="text-slate-600">Target {formatDuration(timer.targetSec)}</span>;
  if (timer.state === 'COMPLETED') {
    return <span>Finished in {formatDuration(timer.elapsedSec)}{timer.overdueSec > 0 && <span className="text-red-700"> ({formatDuration(timer.overdueSec)} over)</span>}</span>;
  }
  const pct = Math.min(100, Math.round((timer.elapsedSec / timer.targetSec) * 100));
  return (
    <div className="min-w-44">
      {timer.state === 'OVERDUE' ? (
        <p className="font-semibold text-red-700">Overdue by {formatDuration(timer.overdueSec)}</p>
      ) : (
        <p className="font-semibold">{formatDuration(timer.remainingSec)} left</p>
      )}
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Processing time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`h-full ${timer.state === 'OVERDUE' ? 'bg-red-600' : 'bg-teal-600'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">of {formatDuration(timer.targetSec)} target</p>
    </div>
  );
}

function StartDialog({ entry, open, onClose }: { entry: QueueEntry; open: boolean; onClose: () => void }) {
  const stations = useStations(open);
  const start = useStartProcessing(entry.id);
  const [stationId, setStationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const close = () => { setStationId(''); setError(null); onClose(); };
  const submit = async () => {
    setError(null);
    try {
      await start.mutateAsync({ stationId });
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open title={`Start processing ${entry.shipment.code}`} onClose={close}>
      <p className="mb-4 text-sm text-slate-600">Starting records the time at the server. The countdown of {formatDuration(entry.targetDurationMin * 60)} begins now.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {stations.isLoading ? <Spinner /> : stations.isError ? <Alert tone="error">{errorMessage(stations.error)}</Alert> : stations.data!.filter((s) => s.isActive).length === 0 ? (
        <Alert tone="warning">There are no active stations. Ask an administrator to add one.</Alert>
      ) : (
        <SelectField label="Processing station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
          <option value="">Choose a station…</option>
          {stations.data!.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id} disabled={s.busy}>{s.name}{s.busy ? ' (in use)' : ''}</option>)}
        </SelectField>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void submit()} disabled={!stationId} loading={start.isPending}>Start processing</Button>
      </div>
    </Dialog>
  );
}

const STATUSES: QueueStatus[] = ['QUEUED', 'IN_PROGRESS', 'COMPLETED'];
type Dlg = { entry: QueueEntry; kind: 'start' | 'complete' } | null;

export function QueuePage() {
  const { user } = useAuth();
  const operator = user?.role === 'FACTORY_OPERATOR';
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const statusParam = params.get('status');
  const status = (STATUSES as string[]).includes(statusParam ?? '') ? (statusParam as QueueStatus) : '';
  const result = useQueue({ page, pageSize: 20, status });
  const [dlg, setDlg] = useState<Dlg>(null);
  const tick = useTicker(1000);

  // The server's clock at fetch time vs this browser's clock, so the countdown follows the server even if the PC clock is off.
  const offset = clockOffsetMs(result.data?.meta.serverNow, result.dataUpdatedAt);
  const serverNow = tick + offset;

  const update = (patch: Record<string, string | undefined>, reset = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (reset) next.delete('page');
    setParams(next);
  };
  const close = () => setDlg(null);

  return (
    <>
      <PageHeader title="Processing queue" description="Shipments released for processing. A countdown reaching zero marks an entry overdue; it never completes it." />
      <Card className="mb-4">
        <div className="max-w-xs">
          <SelectField label="Show" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">Waiting and processing</option>
            {STATUSES.map((s) => <option key={s} value={s}>{QUEUE_STATUS_LABELS[s]}</option>)}
          </SelectField>
        </div>
      </Card>
      {result.isLoading ? <Spinner label="Loading queue" /> : result.isError ? <Alert tone="error">{errorMessage(result.error)}</Alert> : result.data!.items.length === 0 ? (
        <EmptyState title="The queue is empty">Received shipments appear here once an operator releases them to processing.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Processing queue</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Position</th><th scope="col" className="px-4 py-3">Shipment</th><th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3 text-right">Received</th><th scope="col" className="px-4 py-3">Station</th><th scope="col" className="px-4 py-3">Timer</th>
                  <th scope="col" className="px-4 py-3">Status</th>{operator && <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((e) => {
                  const timer = liveTimer(e, serverNow);
                  return (
                    <tr key={e.id} className={timer.state === 'OVERDUE' ? 'bg-red-50' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3">{e.position ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium">{e.shipment.code}</td>
                      <td className="px-4 py-3">{e.request.species}<span className="block text-xs text-slate-500">{e.request.declaredSizeCount}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{e.shipment.receivedQuantityKg ? formatKg(e.shipment.receivedQuantityKg) : '—'}</td>
                      <td className="px-4 py-3">{e.station?.name ?? '—'}</td>
                      <td className="px-4 py-3"><TimerCell timer={timer} />{e.startedAt && <span className="block text-xs text-slate-500">Started {formatDateTime(e.startedAt)}</span>}</td>
                      <td className="px-4 py-3"><Pill tone={e.status === 'COMPLETED' ? 'green' : e.status === 'IN_PROGRESS' ? 'blue' : 'violet'}>{QUEUE_STATUS_LABELS[e.status]}</Pill>{timer.state === 'OVERDUE' && <> <Pill tone="red">Overdue</Pill></>}</td>
                      {operator && (
                        <td className="px-4 py-3 text-right">
                          {e.status === 'QUEUED' && <Button onClick={() => setDlg({ entry: e, kind: 'start' })}>Start</Button>}
                          {e.status === 'IN_PROGRESS' && <Button onClick={() => setDlg({ entry: e, kind: 'complete' })}>Mark complete</Button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data!.meta.page} totalPages={result.data!.meta.totalPages} total={result.data!.meta.total} onChange={(p) => update({ page: String(p) }, false)} />
          {!operator && <p className="mt-3 text-xs text-slate-500">Only factory operators start and complete processing. <Link to="/shipments" className="underline">View shipments</Link></p>}
        </>
      )}

      {dlg?.kind === 'start' && <StartDialog entry={dlg.entry} open onClose={close} />}
      {dlg?.kind === 'complete' && <CompleteDialog entry={dlg.entry} onClose={close} />}
    </>
  );
}

function CompleteDialog({ entry, onClose }: { entry: QueueEntry; onClose: () => void }) {
  const complete = useCompleteProcessing(entry.id);
  return (
    <ReasonDialog
      open
      title={`Mark ${entry.shipment.code} complete?`}
      description="Confirm only when processing has actually finished. The timer does not do this for you, and the time taken is recorded."
      label="Note (optional)"
      confirmLabel="Mark complete"
      required={false}
      onClose={onClose}
      onConfirm={(notes) => complete.mutateAsync(notes ? { notes } : {})}
    />
  );
}
