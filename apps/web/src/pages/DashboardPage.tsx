import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { useBookings, useExceptions, useQueue, useShipments, useTicker } from '../features/factory/hooks';
import { useCollections, useInspections } from '../features/fieldwork/hooks';
import { useRequests, useRequestStats } from '../features/procurement/hooks';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatKg } from '../lib/format';
import { ROLE_LABELS } from '../lib/types';
import { clockOffsetMs, liveTimer } from '../lib/timers';
import { summarizeStats } from '../lib/workflow';
import { CollectionStatusPill } from './CollectionPages';
import { InspectionStatusPill } from './InspectionPages';

function StatCard({ label, value, tone, to }: { label: string; value: number; tone?: 'alert'; to?: string }) {
  const body = (
    <Card className={`!p-4 ${tone === 'alert' && value > 0 ? 'border-amber-300 bg-amber-50' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
  return to ? <Link to={to} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">{body}</Link> : body;
}

function ManagerFactoryStrip() {
  const exceptions = useExceptions({ status: 'OPEN', pageSize: 1 });
  const running = useQueue({ status: 'IN_PROGRESS', pageSize: 50 }, 60_000);
  const tick = useTicker(5000);
  const offset = clockOffsetMs(running.data?.meta.serverNow, running.dataUpdatedAt);
  const overdue = (running.data?.items ?? []).filter((e) => liveTimer(e, tick + offset).state === 'OVERDUE').length;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Open exceptions" value={exceptions.data?.meta.total ?? 0} tone="alert" to="/exceptions?status=OPEN" />
      <StatCard label="Processing now" value={running.data?.meta.total ?? 0} to="/queue?status=IN_PROGRESS" />
      <StatCard label="Overdue processing" value={overdue} tone="alert" to="/queue?status=IN_PROGRESS" />
    </div>
  );
}

function SecurityDashboard() {
  const expected = useBookings({ status: 'RESERVED', pageSize: 5 }, 30_000);
  const onSite = useBookings({ status: 'CHECKED_IN', pageSize: 5 }, 30_000);
  if (expected.isLoading || onSite.isLoading) return <Spinner label="Loading the gate" />;
  const err = expected.error ?? onSite.error;
  if (err) return <Alert tone="error">{errorMessage(err)}</Alert>;
  const upcoming = expected.data!.items;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Vehicles expected" value={expected.data!.meta.total} to="/gate" />
        <StatCard label="Vehicles on site" value={onSite.data!.meta.total} to="/gate" />
      </div>
      <Card>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Next expected</h2><Link to="/gate" className="text-sm font-medium text-teal-800 underline">Open the gate</Link></div>
        {upcoming.length === 0 ? <EmptyState title="No vehicles expected">Bookings appear here.</EmptyState> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {upcoming.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span><span className="font-medium">{b.vehicleRegistration}</span> · {b.shipment.code}<span className="block text-slate-600">{formatDateTime(b.slot.startsAt)} – {formatDateTime(b.slot.endsAt)}</span></span>
                <span>{b.gate.arrived ? 'At the gate' : 'Not arrived'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function OperatorDashboard() {
  const toWeigh = useShipments({ status: 'ADMITTED', pageSize: 5 });
  const toRelease = useShipments({ status: 'RECEIVED', pageSize: 1 });
  const waiting = useQueue({ status: 'QUEUED', pageSize: 1 }, 60_000);
  const running = useQueue({ status: 'IN_PROGRESS', pageSize: 50 }, 60_000);
  const tick = useTicker(5000);
  if (toWeigh.isLoading || toRelease.isLoading || waiting.isLoading || running.isLoading) return <Spinner label="Loading the factory floor" />;
  const err = toWeigh.error ?? toRelease.error ?? waiting.error ?? running.error;
  if (err) return <Alert tone="error">{errorMessage(err)}</Alert>;
  const offset = clockOffsetMs(running.data!.meta.serverNow, running.dataUpdatedAt);
  const overdue = running.data!.items.filter((e) => liveTimer(e, tick + offset).state === 'OVERDUE').length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="On site, to weigh or receive" value={toWeigh.data!.meta.total} to="/shipments?status=ADMITTED" />
        <StatCard label="Received, to release" value={toRelease.data!.meta.total} to="/shipments?status=RECEIVED" />
        <StatCard label="Waiting in queue" value={waiting.data!.meta.total} to="/queue?status=QUEUED" />
        <StatCard label="Processing now" value={running.data!.meta.total} to="/queue?status=IN_PROGRESS" />
        <StatCard label="Overdue" value={overdue} tone="alert" to="/queue?status=IN_PROGRESS" />
      </div>
      <Card>
        <h2 className="mb-3 text-base font-semibold">Vehicles on site</h2>
        {toWeigh.data!.items.length === 0 ? <EmptyState title="No vehicles waiting">Admitted vehicles appear here.</EmptyState> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {toWeigh.data!.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span><Link className="font-medium text-teal-800 underline" to={`/shipments/${s.id}`}>{s.code}</Link> · {s.vehicleRegistration}<span className="block text-slate-600">{s.species} · {s.weights.gross ? 'Gross recorded' : 'Needs gross'} · {s.weights.tare ? 'Tare recorded' : 'Needs tare'}</span></span>
                {s.waitingForHandover && <span className="text-amber-800">Waiting for handover</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ProcurementDashboard({ scope }: { scope: 'own' | 'all' }) {
  const stats = useRequestStats();
  const recent = useRequests({ page: 1, pageSize: 5, sort: 'createdAt', order: 'desc' });

  if (stats.isLoading) return <Spinner label="Loading dashboard" />;
  if (stats.isError) return <Alert tone="error">{errorMessage(stats.error, 'Could not load dashboard figures.')}</Alert>;
  const data = stats.data!;
  const summary = summarizeStats(data.byStatus);
  const manager = scope === 'all';

  return (
    <div className="space-y-6">
      {manager && <ManagerFactoryStrip />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label={scope === 'own' ? 'My requests' : 'All requests'} value={data.total} />
        <StatCard label="Awaiting review" value={summary.awaitingReview} to="/requests?status=SUBMITTED" />
        <StatCard label="Needs decision" value={summary.needsDecision} tone="alert" to={manager ? '/inspections?status=COMPLETED' : undefined} />
        <StatCard label="In progress" value={summary.inProgress} />
        <StatCard label="Delivered" value={summary.delivered} to="/requests?status=DELIVERED" />
        <StatCard label="Rejected / cancelled" value={summary.closed} />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent requests</h2>
          <Link to="/requests" className="text-sm font-medium text-teal-800 underline">View all</Link>
        </div>
        {recent.isLoading ? <Spinner /> : recent.isError ? <Alert tone="error">{errorMessage(recent.error)}</Alert> : recent.data!.items.length === 0 ? (
          <EmptyState title="Nothing here yet">{scope === 'own' ? <Link to="/requests/new" className="font-medium text-teal-800 underline">Submit your first request</Link> : 'Requests will appear when farmers submit them.'}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.data!.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link to={`/requests/${r.id}`} className="font-medium text-teal-800 underline">{r.code}</Link>
                  <p className="text-sm text-slate-600">{r.current.species} · {formatKg(r.current.declaredQuantityKg)} · {formatDateTime(r.createdAt)}</p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function FieldOfficerDashboard() {
  const todo = useInspections({ status: 'ASSIGNED', pageSize: 5 });
  const active = useInspections({ status: 'IN_PROGRESS', pageSize: 5 });
  const done = useInspections({ status: 'COMPLETED', pageSize: 1 });
  if (todo.isLoading || active.isLoading || done.isLoading) return <Spinner label="Loading your inspections" />;
  const err = todo.error ?? active.error ?? done.error;
  if (err) return <Alert tone="error">{errorMessage(err)}</Alert>;
  const open = [...active.data!.items, ...todo.data!.items];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="To start" value={todo.data!.meta.total} to="/inspections?status=ASSIGNED" />
        <StatCard label="In progress" value={active.data!.meta.total} to="/inspections?status=IN_PROGRESS" />
        <StatCard label="Completed" value={done.data!.meta.total} to="/inspections?status=COMPLETED" />
      </div>
      <Card>
        <h2 className="mb-3 text-base font-semibold">Open inspections</h2>
        {open.length === 0 ? <EmptyState title="Nothing assigned right now">New assignments will appear here.</EmptyState> : (
          <ul className="divide-y divide-slate-100">
            {open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link to={`/inspections/${i.id}`} className="font-medium text-teal-800 underline">{i.request.code}</Link>
                  <p className="text-sm text-slate-600">{i.request.farmer.name} · {i.request.farmer.village}, {i.request.farmer.district} · {formatKg(i.request.declaration.declaredQuantityKg)}</p>
                </div>
                <InspectionStatusPill inspection={i} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TransportDashboard() {
  const jobs = useCollections({ pageSize: 20 });
  const done = useCollections({ status: 'HANDED_OVER', pageSize: 1 });
  if (jobs.isLoading || done.isLoading) return <Spinner label="Loading your collections" />;
  const err = jobs.error ?? done.error;
  if (err) return <Alert tone="error">{errorMessage(err)}</Alert>;
  // The database allows one active job per officer, so at most one is "current".
  const current = jobs.data!.items.find((c) => c.status !== 'HANDED_OVER' && c.status !== 'CANCELLED');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Active job" value={current ? 1 : 0} to={current ? `/collections/${current.id}` : undefined} />
        <StatCard label="Completed" value={done.data!.meta.total} to="/collections?status=HANDED_OVER" />
      </div>
      <Card>
        <h2 className="mb-3 text-base font-semibold">Current job</h2>
        {!current ? <EmptyState title="No active job">New assignments will appear here.</EmptyState> : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Link to={`/collections/${current.id}`} className="font-medium text-teal-800 underline">{current.request.code}</Link>
              <p className="text-sm text-slate-600">{current.request.farmer.village}, {current.request.farmer.district} · {current.vehicle.registrationNumber}</p>
              {current.expectedArrivalAt && <p className="text-sm text-slate-600">Expected at factory {formatDateTime(current.expectedArrivalAt)}</p>}
            </div>
            <CollectionStatusPill collection={current} />
          </div>
        )}
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title={`Welcome, ${user.fullName}`} description={`Signed in as ${ROLE_LABELS[user.role]}`} />
      {user.role === 'FARMER' && <ProcurementDashboard scope="own" />}
      {(user.role === 'PURCHASE_MANAGER' || user.role === 'ADMIN') && <ProcurementDashboard scope="all" />}
      {user.role === 'FIELD_OFFICER' && <FieldOfficerDashboard />}
      {user.role === 'TRANSPORT_OFFICER' && <TransportDashboard />}
      {user.role === 'SECURITY_OFFICER' && <SecurityDashboard />}
      {user.role === 'FACTORY_OPERATOR' && <OperatorDashboard />}
    </>
  );
}
