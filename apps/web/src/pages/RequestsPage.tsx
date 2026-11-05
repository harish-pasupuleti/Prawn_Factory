import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, EmptyState, PageHeader, Pagination, SelectField, Spinner, StatusBadge, TextField } from '../components/ui';
import { useRequests, type RequestListParams } from '../features/procurement/hooks';
import { errorMessage } from '../lib/errors';
import { formatDate, formatInr, formatKg } from '../lib/format';
import { PROCUREMENT_STATUSES, STATUS_LABELS, type ProcurementStatus } from '../lib/types';

const SORTS = ['createdAt', 'code', 'status'] as const;

export function RequestsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const staff = user?.role !== 'FARMER';

  const statusParam = params.get('status');
  const status = (PROCUREMENT_STATUSES as readonly string[]).includes(statusParam ?? '') ? (statusParam as ProcurementStatus) : '';
  const sortParam = params.get('sort');
  const sort = (SORTS as readonly string[]).includes(sortParam ?? '') ? (sortParam as (typeof SORTS)[number]) : 'createdAt';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);

  const query: RequestListParams = { page, pageSize: 10, status, q, sort, order };
  const result = useRequests(query);

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    update({ q: search.trim() || undefined });
  };

  return (
    <>
      <PageHeader
        title={staff ? 'Procurement requests' : 'My requests'}
        actions={user?.role === 'FARMER' ? <Link to="/requests/new" className="inline-flex min-h-10 items-center rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">New request</Link> : undefined}
      />
      <Card className="mb-4">
        <form onSubmit={onSearch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <TextField label="Search by request ID" placeholder="PR-2026-000001" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectField label="Status" value={status} onChange={(e) => update({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {PROCUREMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Sort by" value={sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="createdAt">Date submitted</option>
            <option value="code">Request ID</option>
            <option value="status">Status</option>
          </SelectField>
          <SelectField label="Order" value={order} onChange={(e) => update({ order: e.target.value })}>
            <option value="desc">Newest / Z–A first</option>
            <option value="asc">Oldest / A–Z first</option>
          </SelectField>
          <Button type="submit" variant="secondary">
            Apply search
          </Button>
        </form>
      </Card>

      {result.isLoading ? (
        <Spinner label="Loading requests" />
      ) : result.isError ? (
        <Alert tone="error">{errorMessage(result.error, 'Could not load requests.')}</Alert>
      ) : result.data!.items.length === 0 ? (
        <EmptyState title="No requests match">{user?.role === 'FARMER' ? 'Try clearing the filters or submit a new request.' : 'Try clearing the filters.'}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Procurement requests</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Request</th>
                  {staff && <th scope="col" className="px-4 py-3">Farmer</th>}
                  <th scope="col" className="px-4 py-3">Species</th>
                  <th scope="col" className="px-4 py-3 text-right">Quantity</th>
                  <th scope="col" className="px-4 py-3 text-right">Price</th>
                  <th scope="col" className="px-4 py-3">Available</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link to={`/requests/${r.id}`} className="font-medium text-teal-800 underline">
                        {r.code}
                      </Link>
                    </td>
                    {staff && <td className="px-4 py-3">{r.farmer?.name}</td>}
                    <td className="px-4 py-3">{r.current.species}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{formatKg(r.current.declaredQuantityKg)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{formatInr(r.current.expectedPriceInrPerKg)}/kg</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(r.current.availabilityDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
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
