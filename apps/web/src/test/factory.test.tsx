import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '../lib/api';
import { CollectionDetailPage } from '../pages/CollectionPages';
import { ExceptionDetailPage } from '../pages/ExceptionPages';
import { GatePage } from '../pages/GatePage';
import { QueuePage } from '../pages/QueuePage';
import { RequestDetailPage } from '../pages/RequestDetailPage';
import { ShipmentDetailPage } from '../pages/ShipmentPages';
import { bookingFixture, collectionFixture, exceptionFixture, minutes, queueFixture, requestFixture, shipmentFixture, slotFixture } from './fixtures';
import { json, postBodies, renderApp, signedInApi } from './utils';

const page = (path: string, element: JSX.Element, route: string) => renderApp(<Routes><Route path={path} element={element} /></Routes>, { route });
const list = <T,>(items: T[], extraMeta: Record<string, unknown> = {}) => json(200, { data: items, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...extraMeta } });

beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());

describe('gate screen', () => {
  const gate = (b: ReturnType<typeof bookingFixture>) => signedInApi('SECURITY_OFFICER', { 'GET /bookings': () => list([b]), 'POST /bookings/b1/verify': () => json(200, { data: b }) });

  it('offers only the next valid step for each stage', async () => {
    const stages: [Parameters<typeof bookingFixture>[0], string[], string[]][] = [
      [{ actions: ['arrive'] }, ['Vehicle arrived'], ['Verify vehicle', 'Admit to factory', 'Refuse entry']],
      [{ actions: ['verify', 'hold', 'reject'], gate: { ...bookingFixture().gate, arrived: true } }, ['Verify vehicle', 'Place on hold', 'Refuse entry'], ['Vehicle arrived', 'Admit to factory']],
      [{ actions: ['hold', 'reject', 'admit'], gate: { ...bookingFixture().gate, arrived: true, verified: true } }, ['Admit to factory', 'Place on hold'], ['Verify vehicle']],
      [{ status: 'CHECKED_IN', weighed: true, actions: ['exit'], gate: { ...bookingFixture().gate, arrived: true, verified: true, admitted: true } }, ['Vehicle leaving'], ['Vehicle arrived', 'Admit to factory']],
    ];
    for (const [overrides, present, absent] of stages) {
      gate(bookingFixture(overrides));
      const { unmount } = page('/gate', <GatePage />, '/gate');
      await screen.findByText('AP31TX1234');
      for (const label of present) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      for (const label of absent) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('verification sends exactly the registration number that was typed', async () => {
    const fn = gate(bookingFixture({ actions: ['verify', 'hold', 'reject'], gate: { ...bookingFixture().gate, arrived: true } }));
    page('/gate', <GatePage />, '/gate');
    await userEvent.click(await screen.findByRole('button', { name: 'Verify vehicle' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Verify' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Registration number on the vehicle'), 'AP31TX1234');
    await userEvent.click(confirm);
    await waitFor(() => expect(postBodies(fn, '/bookings/b1/verify')).toEqual([{ registrationNumber: 'AP31TX1234' }]));
  });

  it('refusing entry needs a written reason before anything is sent', async () => {
    const fn = signedInApi('SECURITY_OFFICER', {
      'GET /bookings': () => list([bookingFixture({ actions: ['verify', 'hold', 'reject'], gate: { ...bookingFixture().gate, arrived: true } })]),
      'POST /bookings/b1/reject': () => json(200, { data: bookingFixture() }),
    });
    page('/gate', <GatePage />, '/gate');
    await userEvent.click(await screen.findByRole('button', { name: 'Refuse entry' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Refuse entry' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Reason for refusing entry'), 'Strong ammonia smell');
    await userEvent.click(confirm);
    await waitFor(() => expect(postBodies(fn, '/bookings/b1/reject')).toEqual([{ reason: 'Strong ammonia smell' }]));
  });

  it('explains why a vehicle outside its slot cannot be admitted, and shows server refusals', async () => {
    gate(bookingFixture({ window: 'LATE', actions: ['hold', 'reject'], gate: { ...bookingFixture().gate, arrived: true, verified: true } }));
    page('/gate', <GatePage />, '/gate');
    expect(await screen.findByText(/purchase manager must authorise entry/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admit to factory' })).not.toBeInTheDocument();
  });

  it('shows the server’s message when a step is refused', async () => {
    signedInApi('SECURITY_OFFICER', {
      'GET /bookings': () => list([bookingFixture()]),
      'POST /bookings/b1/arrive': () => json(409, { error: { code: 'INVALID_GATE_ACTION', message: 'This gate step is not available for the vehicle right now' } }),
    });
    page('/gate', <GatePage />, '/gate');
    await userEvent.click(await screen.findByRole('button', { name: 'Vehicle arrived' }));
    expect(await screen.findByText(/not available for the vehicle right now/)).toBeInTheDocument();
  });

  it('shows a hold clearly and offers no way to release it to security', async () => {
    gate(bookingFixture({ actions: ['reject'], gate: { ...bookingFixture().gate, arrived: true, held: true } }));
    page('/gate', <GatePage />, '/gate');
    expect(await screen.findByText(/Only a purchase manager can release it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Release hold/ })).not.toBeInTheDocument();
  });
});

describe('weighing and reception', () => {
  const open = (role: Parameters<typeof signedInApi>[0], s: ReturnType<typeof shipmentFixture>, extra: Record<string, (i: RequestInit) => Response> = {}) =>
    signedInApi(role, { 'GET /shipments/sh1': () => json(200, { data: s }), ...extra });
  const render = () => page('/shipments/:id', <ShipmentDetailPage />, '/shipments/sh1');

  it('validates a weight before sending and then sends it exactly', async () => {
    const fn = open('FACTORY_OPERATOR', shipmentFixture(), { 'POST /shipments/sh1/weights': () => json(201, { data: shipmentFixture() }) });
    render();
    const input = await screen.findByLabelText(/Gross weight/);
    const button = screen.getByRole('button', { name: 'Record gross' });
    await userEvent.type(input, '-5');
    await userEvent.click(button);
    expect(await screen.findByText(/at most 3 decimal places/)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    await userEvent.click(button);
    expect(await screen.findByText(/greater than zero/)).toBeInTheDocument();
    expect(postBodies(fn, '/weights')).toHaveLength(0);
    await userEvent.clear(input);
    await userEvent.type(input, '1250.5');
    await userEvent.click(button);
    await waitFor(() => expect(postBodies(fn, '/weights')).toEqual([{ kind: 'GROSS', valueKg: '1250.5' }]));
  });

  it('shows the server’s refusal, for example a tare larger than the gross', async () => {
    open('FACTORY_OPERATOR', shipmentFixture({ can: { recordGross: false, recordTare: true, receive: false, release: false, correct: false } }), {
      'POST /shipments/sh1/weights': () => json(400, { error: { code: 'TARE_EXCEEDS_GROSS', message: 'Tare weight cannot be greater than gross weight' } }),
    });
    render();
    await userEvent.type(await screen.findByLabelText(/Tare weight/), '900');
    await userEvent.click(screen.getByRole('button', { name: 'Record tare' }));
    expect(await screen.findByText(/cannot be greater than gross weight/)).toBeInTheDocument();
  });

  it('operators never see earlier measurements or the correction control; managers do', async () => {
    const received = shipmentFixture({
      status: 'RECEIVED', can: { recordGross: false, recordTare: false, receive: false, release: true, correct: false },
      weights: { gross: { valueKg: '1000.000', recordedBy: 'Op', at: new Date().toISOString(), corrected: false }, tare: { valueKg: '600.000', recordedBy: 'Op', at: new Date().toISOString(), corrected: false }, netKg: '400.000' },
      receivedQuantityKg: '400.000', receivedAt: new Date().toISOString(),
    });
    open('FACTORY_OPERATOR', received);
    const first = render();
    await screen.findByText('Weighing');
    expect(screen.queryByText('Comparison with earlier measurements')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Correct a weight' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release to processing' })).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();

    open('PURCHASE_MANAGER', { ...received, can: { ...received.can, release: false, correct: true }, collectedQuantityKg: '400.000', variancePct: '0.00', thresholdPct: 5, history: [] });
    render();
    expect(await screen.findByText('Comparison with earlier measurements')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct a weight' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release to processing' })).not.toBeInTheDocument();
  });

  it('waits for the driver’s handover before reception can be completed', async () => {
    open('FACTORY_OPERATOR', shipmentFixture({ waitingForHandover: true, can: { recordGross: false, recordTare: false, receive: false, release: false, correct: false }, weights: { gross: { valueKg: '1000.000', recordedBy: 'Op', at: new Date().toISOString(), corrected: false }, tare: { valueKg: '600.000', recordedBy: 'Op', at: new Date().toISOString(), corrected: false }, netKg: '400.000' } }));
    render();
    expect(await screen.findByText(/once the driver has recorded the handover/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete reception' })).not.toBeInTheDocument();
  });

  it('a weight discrepancy blocks release and is flagged', async () => {
    open('FACTORY_OPERATOR', shipmentFixture({ status: 'RECEIVED', hasOpenDiscrepancy: true, receivedQuantityKg: '350.000', can: { recordGross: false, recordTare: false, receive: false, release: false, correct: false } }));
    render();
    expect(await screen.findByText(/purchase manager must resolve this/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release to processing' })).not.toBeInTheDocument();
  });

  it('completing reception asks for confirmation first', async () => {
    const ready = shipmentFixture({ handedOver: true, can: { recordGross: false, recordTare: false, receive: true, release: false, correct: false }, weights: { gross: null, tare: null, netKg: '400.000' } });
    const fn = open('FACTORY_OPERATOR', ready, { 'POST /shipments/sh1/receive': () => json(200, { data: ready }) });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete reception' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/400 kg becomes the received quantity/)).toBeInTheDocument();
    expect(postBodies(fn, '/receive')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete reception' }));
    await waitFor(() => expect(postBodies(fn, '/receive')).toHaveLength(1));
  });
});

describe('processing queue', () => {
  const entry = (over: Partial<ReturnType<typeof queueFixture>>) => queueFixture(over);
  const running = (startedMinutesAgo: number, target = 48) => entry({
    id: 'q2', status: 'IN_PROGRESS', position: null, targetDurationMin: target, station: { id: 'st1', name: 'Line 1' },
    startedAt: new Date(Date.now() - minutes(startedMinutesAgo)).toISOString(),
    timer: { state: 'RUNNING', targetSec: target * 60, elapsedSec: startedMinutesAgo * 60, remainingSec: 0, overdueSec: 0 },
  });
  const queue = (role: Parameters<typeof signedInApi>[0], items: ReturnType<typeof queueFixture>[], extra: Record<string, (i: RequestInit) => Response> = {}) =>
    signedInApi(role, { 'GET /queue': () => list(items, { serverNow: new Date().toISOString() }), ...extra });

  it('shows a live countdown computed from the stored start time', async () => {
    queue('FACTORY_OPERATOR', [running(20)]);
    page('/queue', <QueuePage />, '/queue');
    expect(await screen.findByText(/\d+m \d{2}s left/)).toBeInTheDocument();
    expect(screen.getByText(/of 48m 00s target/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Processing time used' })).toHaveAttribute('aria-valuenow', '42');
  });

  it('a timer past zero is shown as overdue, and the entry stays open with its complete button', async () => {
    queue('FACTORY_OPERATOR', [running(180)]);
    page('/queue', <QueuePage />, '/queue');
    expect(await screen.findByText(/Overdue by/)).toBeInTheDocument();
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table')).getByText('Processing')).toBeInTheDocument(); // still in progress, not completed
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
  });

  it('completing is explicit and sends nothing until confirmed', async () => {
    const fn = queue('FACTORY_OPERATOR', [running(20)], { 'POST /queue/q2/complete': () => json(200, { data: running(20) }) });
    page('/queue', <QueuePage />, '/queue');
    await userEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The timer does not do this for you/)).toBeInTheDocument();
    expect(postBodies(fn, '/complete')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(postBodies(fn, '/complete')).toEqual([{}]));
  });

  it('starting needs a station and skips stations that are in use', async () => {
    const fn = queue('FACTORY_OPERATOR', [entry({})], {
      'GET /stations': () => json(200, { data: [{ id: 'st1', name: 'Line 1', isActive: true, busy: true }, { id: 'st2', name: 'Line 2', isActive: true, busy: false }, { id: 'st3', name: 'Old line', isActive: false, busy: false }] }),
      'POST /queue/q1/start': () => json(200, { data: entry({}) }),
    });
    page('/queue', <QueuePage />, '/queue');
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }));
    const dialog = await screen.findByRole('dialog');
    const start = within(dialog).getByRole('button', { name: 'Start processing' });
    expect(start).toBeDisabled();
    expect(await within(dialog).findByRole('option', { name: 'Line 1 (in use)' })).toBeDisabled();
    expect(within(dialog).queryByRole('option', { name: 'Old line' })).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Processing station'), 'st2');
    await userEvent.click(start);
    await waitFor(() => expect(postBodies(fn, '/start')).toEqual([{ stationId: 'st2' }]));
  });

  it('managers can watch the queue but have no start or complete buttons', async () => {
    queue('PURCHASE_MANAGER', [entry({}), { ...running(10), shipment: { id: 'sh9', code: 'SH-2026-000009', receivedQuantityKg: '300.000' } }]);
    page('/queue', <QueuePage />, '/queue');
    await screen.findByText('SH-2026-000009');
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only factory operators start and complete processing/)).toBeInTheDocument();
  });

  it('numbers waiting entries in order', async () => {
    queue('FACTORY_OPERATOR', [entry({ id: 'qa', position: 1 }), entry({ id: 'qb', position: 2, shipment: { id: 'shb', code: 'SH-2026-000002', receivedQuantityKg: '500.000' } })]);
    page('/queue', <QueuePage />, '/queue');
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]!).getByText('1')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('2')).toBeInTheDocument();
  });
});

describe('exceptions', () => {
  const open = (role: Parameters<typeof signedInApi>[0], e = exceptionFixture(), extra: Record<string, (i: RequestInit) => Response> = {}) =>
    signedInApi(role, { 'GET /exceptions/e1': () => json(200, { data: e }), ...extra });

  it('only the purchase manager can resolve, and a reason is mandatory', async () => {
    const fn = open('PURCHASE_MANAGER', exceptionFixture(), { 'POST /exceptions/e1/resolve': () => json(200, { data: exceptionFixture({ status: 'RESOLVED' }) }) });
    page('/exceptions/:id', <ExceptionDetailPage />, '/exceptions/e1');
    expect(await screen.findByText(/Received 350 kg against 400 kg/)).toBeInTheDocument();
    expect(screen.getByText('12.50')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve exception' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Resolve' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Resolution'), 'Ice melt confirmed by the driver');
    await userEvent.click(confirm);
    await waitFor(() => expect(postBodies(fn, '/resolve')).toEqual([{ resolution: 'Ice melt confirmed by the driver' }]));
  });

  it('administrators can add notes but not resolve', async () => {
    open('ADMIN');
    page('/exceptions/:id', <ExceptionDetailPage />, '/exceptions/e1');
    expect(await screen.findByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve exception' })).not.toBeInTheDocument();
  });

  it('a resolved exception shows its resolution and offers no further actions', async () => {
    open('PURCHASE_MANAGER', exceptionFixture({ status: 'RESOLVED', resolvedBy: 'Manager', resolvedAt: new Date().toISOString(), resolution: 'Ice melt confirmed' }));
    page('/exceptions/:id', <ExceptionDetailPage />, '/exceptions/e1');
    expect(await screen.findByText(/Ice melt confirmed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve exception' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });
});

describe('booking an arrival slot', () => {
  it('the manager can book from a collection; full slots cannot be chosen', async () => {
    const fn = signedInApi('PURCHASE_MANAGER', {
      'GET /collections/c1': () => json(200, { data: collectionFixture('ASSIGNED') }),
      'GET /slots': () => list([slotFixture({ id: 's1' }), slotFixture({ id: 's2', available: 0, bookedCount: 3 })]),
      'POST /bookings': () => json(201, { data: bookingFixture() }),
    });
    page('/collections/:id', <CollectionDetailPage />, '/collections/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Book a slot' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('option', { name: /full/ })).toBeDisabled();
    const book = within(dialog).getByRole('button', { name: 'Book slot' });
    expect(book).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Arrival slot'), 's1');
    await userEvent.click(book);
    await waitFor(() => expect(postBodies(fn, '/bookings')).toEqual([{ collectionJobId: 'c1', slotId: 's1' }]));
  });

  it('drivers see their slot but have no booking control', async () => {
    signedInApi('TRANSPORT_OFFICER', {
      'GET /collections/c1': () => json(200, { data: collectionFixture('ASSIGNED', { shipment: { id: 'sh1', code: 'SH-2026-000001', status: 'EXPECTED', booking: { id: 'b1', status: 'RESERVED', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() } } }) }),
    });
    page('/collections/:id', <CollectionDetailPage />, '/collections/c1');
    expect(await screen.findByText(/Shipment code/)).toBeInTheDocument();
    expect(screen.getByText('SH-2026-000001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book a slot' })).not.toBeInTheDocument();
  });
});

describe('what the farmer sees at the factory', () => {
  it('received quantity and status only, with no staff-only details', async () => {
    const request = requestFixture('RECEIVED', { shipments: [{ id: 'sh1', code: 'SH-2026-000001', status: 'RECEIVED', receivedQuantityKg: '398.500', receivedAt: new Date().toISOString() }] }, false);
    signedInApi('FARMER', { 'GET /procurement/r1': () => json(200, { data: request }) });
    page('/requests/:id', <RequestDetailPage />, '/requests/r1');
    expect(await screen.findByText('At the factory')).toBeInTheDocument();
    expect(screen.getByText('SH-2026-000001')).toBeInTheDocument();
    expect(screen.getByText(/398.5 kg/)).toBeInTheDocument();
    expect(screen.queryByText(/Open exception/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Queue:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });
});
