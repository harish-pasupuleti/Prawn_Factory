import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api';
import type { Role } from '../lib/types';
import { CollectionDetailPage } from '../pages/CollectionPages';
import { InspectionDetailPage } from '../pages/InspectionPages';
import { RequestDetailPage } from '../pages/RequestDetailPage';
import { collectionFixture, inspectionFixture, requestFixture, userFor } from './fixtures';
import { json, mockFetch, renderApp } from './utils';

type Routes_ = Record<string, (init: RequestInit) => Response>;

/** Signed-in session plus a routing table keyed by "METHOD /path". */
function api(role: Role, routes: Routes_) {
  return mockFetch((url, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.endsWith('/auth/refresh')) return json(200, { data: { accessToken: 't', user: userFor(role) } });
    const key = `${method} ${url.replace('/api/v1', '')}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(init);
  });
}

const bodies = (fn: ReturnType<typeof mockFetch>, suffix: string) =>
  fn.mock.calls.filter(([u, i]) => String(u).endsWith(suffix) && (i as RequestInit | undefined)?.method === 'POST').map(([, i]) => JSON.parse(String((i as RequestInit).body)));

describe('field inspection screen', () => {
  beforeEach(() => setAccessToken(null));
  afterEach(() => vi.unstubAllGlobals());

  const page = () => renderApp(<Routes><Route path="/inspections/:id" element={<InspectionDetailPage />} /></Routes>, { route: '/inspections/i1' });

  it('validates findings, asks for confirmation, then submits exact values', async () => {
    const fn = api('FIELD_OFFICER', {
      'GET /inspections/i1': () => json(200, { data: inspectionFixture('IN_PROGRESS') }),
      'POST /inspections/i1/complete': () => json(200, { data: inspectionFixture('COMPLETED', { outcome: 'PASS' }) }),
    });
    page();
    const submit = await screen.findByRole('button', { name: 'Review and submit' });
    await userEvent.click(submit);
    expect(await screen.findByText('Quality observations are required')).toBeInTheDocument();
    expect(screen.getByText(/Quantity must be a number/)).toBeInTheDocument();
    expect(bodies(fn, '/complete')).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Inspected quantity (kg)'), '395.5');
    await userEvent.type(screen.getByLabelText('Quality observations'), 'Fresh, firm texture');
    await userEvent.click(submit);
    const dialog = await screen.findByRole('dialog', { name: 'Submit these findings?' });
    expect(within(dialog).getByText('395.5 kg')).toBeInTheDocument();
    expect(bodies(fn, '/complete')).toHaveLength(0); // nothing sent until confirmed

    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit findings' }));
    await waitFor(() => expect(bodies(fn, '/complete')).toHaveLength(1));
    expect(bodies(fn, '/complete')[0]).toMatchObject({ outcome: 'PASS', inspectedQuantityKg: '395.5', observedSpecies: 'Vannamei', qualityNotes: 'Fresh, firm texture' });
  });

  it('shows the server’s discrepancy requirement next to the notes field', async () => {
    api('FIELD_OFFICER', {
      'GET /inspections/i1': () => json(200, { data: inspectionFixture('IN_PROGRESS') }),
      'POST /inspections/i1/complete': () => json(400, { error: { code: 'DISCREPANCY_NOTES_REQUIRED', message: 'The findings differ from the declaration. Explain the discrepancy before passing.', details: { quantityOff: true } } }),
    });
    page();
    await userEvent.type(await screen.findByLabelText('Inspected quantity (kg)'), '100');
    await userEvent.type(screen.getByLabelText('Quality observations'), 'Half harvested');
    await userEvent.click(screen.getByRole('button', { name: 'Review and submit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Submit findings' }));
    expect(await screen.findByText(/Explain the discrepancy before passing/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers Start to an officer on an assigned inspection but no findings form', async () => {
    api('FIELD_OFFICER', { 'GET /inspections/i1': () => json(200, { data: inspectionFixture('ASSIGNED') }) });
    page();
    expect(await screen.findByRole('button', { name: 'Start inspection' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review and submit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel this assignment')).not.toBeInTheDocument();
  });

  it('gives the manager a decision panel only for a FAIL or REVIEW without a decision', async () => {
    const failed = inspectionFixture('COMPLETED', { outcome: 'FAIL', inspectedQuantityKg: '380.000', qualityNotes: 'Spoiled', request: { ...inspectionFixture('COMPLETED').request, status: 'INSPECTION_FAILED' } });
    const fn = api('PURCHASE_MANAGER', {
      'GET /inspections/i1': () => json(200, { data: failed }),
      'POST /inspections/i1/decision': () => json(200, { data: failed }),
    });
    page();
    expect(await screen.findByText('Decision required')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Proceed with exception' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Proceed with exception' });
    expect(confirm).toBeDisabled(); // a reason is mandatory
    await userEvent.type(within(dialog).getByLabelText('Reason for the exception'), 'Supervisor re-graded on site');
    await userEvent.click(confirm);
    await waitFor(() => expect(bodies(fn, '/decision')).toEqual([{ decision: 'PROCEED', reason: 'Supervisor re-graded on site' }]));
  });

  it('shows no decision panel for a PASS', async () => {
    api('PURCHASE_MANAGER', { 'GET /inspections/i1': () => json(200, { data: inspectionFixture('COMPLETED', { outcome: 'PASS', inspectedQuantityKg: '400.000' }) }) });
    page();
    expect(await screen.findByText('Findings')).toBeInTheDocument();
    expect(screen.queryByText('Decision required')).not.toBeInTheDocument();
  });
});

describe('collection screen', () => {
  beforeEach(() => setAccessToken(null));
  afterEach(() => vi.unstubAllGlobals());

  const page = () => renderApp(<Routes><Route path="/collections/:id" element={<CollectionDetailPage />} /></Routes>, { route: '/collections/c1' });

  it('shows only the next valid step for the current status', async () => {
    const cases: [Parameters<typeof collectionFixture>[0], string][] = [
      ['ASSIGNED', 'Confirm pickup'], ['LOADED', 'Dispatch to factory'], ['DISPATCHED', 'Mark arrived at factory'], ['ARRIVED', 'Record handover'],
    ];
    for (const [status, label] of cases) {
      api('TRANSPORT_OFFICER', { 'GET /collections/c1': () => json(200, { data: collectionFixture(status) }) });
      const { unmount } = page();
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
      expect(screen.getAllByRole('button').filter((b) => /Confirm pickup|Dispatch to factory|Mark arrived|Record handover|Record loading/.test(b.textContent ?? ''))).toHaveLength(1);
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('offers no step on a closed job', async () => {
    api('TRANSPORT_OFFICER', { 'GET /collections/c1': () => json(200, { data: collectionFixture('HANDED_OVER') }) });
    page();
    expect(await screen.findByText('Progress')).toBeInTheDocument();
    expect(screen.queryByText('Next step')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report incident' })).not.toBeInTheDocument();
  });

  it('validates the loaded quantity and shows the server’s note requirement on the notes field', async () => {
    const fn = api('TRANSPORT_OFFICER', {
      'GET /collections/c1': () => json(200, { data: collectionFixture('PICKED_UP') }),
      'POST /collections/c1/load': () => json(400, { error: { code: 'NOTES_REQUIRED', message: 'The collected quantity differs from the inspected quantity. Add a note explaining why.' } }),
    });
    page();
    const button = await screen.findByRole('button', { name: 'Record loading' });
    await userEvent.click(button);
    expect(await screen.findByText(/Quantity must be a number/)).toBeInTheDocument();
    expect(bodies(fn, '/load')).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Quantity actually collected (kg)'), '250');
    await userEvent.click(button);
    expect(await screen.findByText(/Add a note explaining why/)).toBeInTheDocument();
    expect(bodies(fn, '/load')[0]).toEqual({ collectedQuantityKg: '250' });
  });

  it('requires an expected arrival time to dispatch when none was set', async () => {
    api('TRANSPORT_OFFICER', { 'GET /collections/c1': () => json(200, { data: collectionFixture('LOADED', { expectedArrivalAt: null }) }) });
    page();
    expect(await screen.findByRole('button', { name: 'Dispatch to factory' })).toBeDisabled();
  });

  it('flags overdue jobs and gives the manager a cancel option only before dispatch', async () => {
    api('PURCHASE_MANAGER', { 'GET /collections/c1': () => json(200, { data: collectionFixture('LOADED', { overdue: true }) }) });
    const first = page();
    expect(await screen.findByText(/This collection is overdue/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel this collection' })).toBeInTheDocument();
    expect(screen.queryByText('Next step')).not.toBeInTheDocument(); // managers cannot perform transport steps
    first.unmount();
    vi.unstubAllGlobals();

    api('PURCHASE_MANAGER', { 'GET /collections/c1': () => json(200, { data: collectionFixture('DISPATCHED') }) });
    page();
    await screen.findByText('Progress');
    expect(screen.queryByRole('button', { name: 'Cancel this collection' })).not.toBeInTheDocument();
  });
});

describe('request detail: assignment actions follow the workflow', () => {
  beforeEach(() => setAccessToken(null));
  afterEach(() => vi.unstubAllGlobals());

  const page = () => renderApp(<Routes><Route path="/requests/:id" element={<RequestDetailPage />} /></Routes>, { route: '/requests/r1' });
  const has = (name: string) => screen.queryByRole('button', { name }) ?? screen.queryByRole('link', { name });

  it('manager can assign a field officer to an APPROVED request and the call carries only the officer id', async () => {
    const fn = api('PURCHASE_MANAGER', {
      'GET /procurement/r1': () => json(200, { data: requestFixture('APPROVED') }),
      'GET /assignees?role=FIELD_OFFICER': () => json(200, { data: [{ id: 'o1', fullName: 'Officer One', activeCount: 0 }, { id: 'o2', fullName: 'Officer Two', activeCount: 3 }] }),
      'POST /procurement/r1/inspections': () => json(201, { data: inspectionFixture('ASSIGNED') }),
    });
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'Assign field officer' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('option', { name: 'Officer Two (3 open)' })).toBeInTheDocument();
    const assign = within(dialog).getByRole('button', { name: 'Assign officer' });
    expect(assign).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Field officer'), 'o1');
    await userEvent.click(assign);
    await waitFor(() => expect(bodies(fn, '/inspections')).toEqual([{ officerId: 'o1' }]));
  });

  it('shows the right manager action for each status', async () => {
    const cases: [Parameters<typeof requestFixture>[0], string | null][] = [
      ['APPROVED', 'Assign field officer'],
      ['INSPECTION_PASSED', 'Assign transport'],
      ['INSPECTION_ASSIGNED', null],
      ['TRANSPORT_ASSIGNED', null],
      ['IN_TRANSIT', null],
    ];
    for (const [status, label] of cases) {
      api('PURCHASE_MANAGER', { 'GET /procurement/r1': () => json(200, { data: requestFixture(status) }) });
      const { unmount } = page();
      await screen.findByText('PR-2026-000001');
      for (const candidate of ['Assign field officer', 'Assign transport']) {
        if (candidate === label) expect(has(candidate)).not.toBeNull();
        else expect(has(candidate)).toBeNull();
      }
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('a failed inspection offers a review link, never transport assignment', async () => {
    const request = requestFixture('INSPECTION_FAILED', {
      inspections: [{ id: 'i9', status: 'COMPLETED', outcome: 'FAIL', completedAt: '2026-10-21T05:00:00.000Z', officerName: 'Officer One', observedSpecies: 'Vannamei', observedSizeCount: '30-40', inspectedQuantityKg: '380.000', qualityNotes: 'Spoiled', discrepancyNotes: null }],
    });
    api('PURCHASE_MANAGER', { 'GET /procurement/r1': () => json(200, { data: request }) });
    page();
    expect(await screen.findByRole('link', { name: 'Review inspection result' })).toHaveAttribute('href', '/inspections/i9');
    expect(has('Assign transport')).toBeNull();
  });

  it('farmers cannot cancel once field work has started, and never see assignment actions', async () => {
    api('FARMER', { 'GET /procurement/r1': () => json(200, { data: requestFixture('INSPECTION_ASSIGNED', {}, false) }) });
    const first = page();
    await screen.findByText('PR-2026-000001');
    expect(has('Cancel request')).toBeNull();
    expect(has('Assign field officer')).toBeNull();
    first.unmount();
    vi.unstubAllGlobals();

    api('FARMER', { 'GET /procurement/r1': () => json(200, { data: requestFixture('APPROVED', {}, false) }) });
    page();
    expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
  });

  it('farmers see inspection and collection progress without internal fields', async () => {
    const request = requestFixture('TRANSPORT_ASSIGNED', {
      inspections: [{ id: 'i1', status: 'COMPLETED', outcome: 'PASS', completedAt: '2026-10-21T05:00:00.000Z', officerName: 'Officer One', observedSpecies: 'Vannamei', observedSizeCount: '30-40', inspectedQuantityKg: '400.000', qualityNotes: 'Fresh', discrepancyNotes: null }],
      collections: [{ id: 'c1', status: 'ASSIGNED', vehicleRegistration: 'AP31TX1234', officerName: 'Driver One', scheduledPickupAt: null, expectedArrivalAt: '2026-10-22T15:00:00.000Z', pickedUpAt: null, collectedQuantityKg: null, dispatchedAt: null, arrivedAt: null, handedOverAt: null, overdue: false }],
    }, false);
    api('FARMER', { 'GET /procurement/r1': () => json(200, { data: request }) });
    page();
    expect(await screen.findByText('Field inspection')).toBeInTheDocument();
    expect(screen.getByText('AP31TX1234')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.queryByText(/incident/i)).not.toBeInTheDocument();
  });
});
