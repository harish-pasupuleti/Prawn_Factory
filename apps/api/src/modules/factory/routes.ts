import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import type { GateAction } from './gateRules';
import * as bookings from './bookings';
import * as exceptions from './exceptions';
import * as queue from './queue';
import {
  completeQueueSchema, correctWeightSchema, createBookingSchema, createSlotSchema, createStationSchema, emptyBodySchema, exceptionNoteSchema,
  listBookingsQuerySchema, listExceptionsQuerySchema, listQueueQuerySchema, listShipmentsQuerySchema, listSlotsQuerySchema,
  optionalReasonSchema, reasonOnlySchema, recordWeightSchema, rescheduleBookingSchema, resolveExceptionSchema, startQueueSchema,
  updateSlotSchema, updateStationSchema, verifySchema,
} from './schemas';
import * as shipments from './shipments';
import * as slots from './slots';
import * as stations from './stations';

const idParam = z.object({ id: z.string().uuid() });

export function slotsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireRole('PURCHASE_MANAGER', 'ADMIN'));

  router.get('/', async (req, res) => {
    const { items, meta } = await slots.listSlots(listSlotsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.post('/', async (req, res) => {
    res.status(201).json({ data: await slots.createSlot(req.user!, createSlotSchema.parse(req.body), req.ip) });
  });
  router.patch('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await slots.updateSlot(req.user!, id, updateSlotSchema.parse(req.body), req.ip) });
  });
  return router;
}

export function bookingsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requireRole('PURCHASE_MANAGER', 'ADMIN', 'SECURITY_OFFICER'), async (req, res) => {
    const { items, meta } = await bookings.listBookings(req.user!, listBookingsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.get('/:id', requireRole('PURCHASE_MANAGER', 'ADMIN', 'SECURITY_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await bookings.getBooking(req.user!, id) });
  });

  // Scheduling: Purchase Manager only.
  router.post('/', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    res.status(201).json({ data: await bookings.createBooking(req.user!, createBookingSchema.parse(req.body), req.ip) });
  });
  router.post('/:id/reschedule', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await bookings.rescheduleBooking(req.user!, id, rescheduleBookingSchema.parse(req.body), req.ip) });
  });
  router.post('/:id/cancel', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = reasonOnlySchema.parse(req.body);
    res.json({ data: await bookings.cancelBooking(req.user!, id, reason, req.ip) });
  });
  router.post('/:id/no-show', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = optionalReasonSchema.parse(req.body);
    res.json({ data: await bookings.markNoShow(req.user!, id, reason, req.ip) });
  });

  // Gate steps: Security Officer.
  const gate = (path: string, action: GateAction, parse: (body: unknown) => { registrationNumber?: string; sealCode?: string | undefined; reason?: string }) =>
    router.post(`/:id/${path}`, requireRole('SECURITY_OFFICER'), async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json({ data: await bookings.gateAction(req.user!, id, action, parse(req.body), req.ip) });
    });
  gate('arrive', 'arrive', (b) => (emptyBodySchema.parse(b), {}));
  gate('verify', 'verify', (b) => verifySchema.parse(b));
  gate('hold', 'hold', (b) => reasonOnlySchema.parse(b));
  gate('reject', 'reject', (b) => reasonOnlySchema.parse(b));
  gate('admit', 'admit', (b) => (emptyBodySchema.parse(b), {}));
  gate('exit', 'exit', (b) => (emptyBodySchema.parse(b), {}));

  // Authorisation steps: Purchase Manager, always with a reason.
  const authorise = (path: string, action: GateAction) =>
    router.post(`/:id/${path}`, requireRole('PURCHASE_MANAGER'), async (req, res) => {
      const { id } = idParam.parse(req.params);
      res.json({ data: await bookings.gateAction(req.user!, id, action, reasonOnlySchema.parse(req.body), req.ip) });
    });
  authorise('release-hold', 'releaseHold');
  authorise('override', 'override');

  return router;
}

export function shipmentsRouter(): Router {
  const router = Router();
  router.use(authenticate);
  const viewers = requireRole('PURCHASE_MANAGER', 'ADMIN', 'FACTORY_OPERATOR');

  router.get('/', viewers, async (req, res) => {
    const { items, meta } = await shipments.listShipments(req.user!, listShipmentsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.get('/:id', viewers, async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await shipments.getShipment(req.user!, id) });
  });
  router.post('/:id/weights', requireRole('FACTORY_OPERATOR'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json({ data: await shipments.recordWeight(req.user!, id, recordWeightSchema.parse(req.body), req.ip) });
  });
  router.post('/:id/weights/correct', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await shipments.correctWeight(req.user!, id, correctWeightSchema.parse(req.body), req.ip) });
  });
  router.post('/:id/receive', requireRole('FACTORY_OPERATOR'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    emptyBodySchema.parse(req.body);
    res.json({ data: await shipments.receiveShipment(req.user!, id, req.ip) });
  });
  router.post('/:id/release', requireRole('FACTORY_OPERATOR'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    emptyBodySchema.parse(req.body);
    res.json({ data: await shipments.releaseToProcessing(req.user!, id, req.ip) });
  });
  return router;
}

export function exceptionsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireRole('PURCHASE_MANAGER', 'ADMIN'));

  router.get('/', async (req, res) => {
    const { items, meta } = await exceptions.listExceptions(listExceptionsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await exceptions.getException(id) });
  });
  router.post('/:id/notes', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { note } = exceptionNoteSchema.parse(req.body);
    res.status(201).json({ data: await exceptions.addNote(req.user!, id, note, req.ip) });
  });
  router.post('/:id/resolve', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { resolution } = resolveExceptionSchema.parse(req.body);
    res.json({ data: await exceptions.resolveException(req.user!, id, resolution, req.ip) });
  });
  return router;
}

export function stationsRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', requireRole('ADMIN', 'PURCHASE_MANAGER', 'FACTORY_OPERATOR'), async (_req, res) => {
    res.json({ data: await stations.listStations() });
  });
  router.post('/', requireRole('ADMIN'), async (req, res) => {
    const { name } = createStationSchema.parse(req.body);
    res.status(201).json({ data: await stations.createStation(req.user!, name, req.ip) });
  });
  router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await stations.updateStation(req.user!, id, updateStationSchema.parse(req.body), req.ip) });
  });
  return router;
}

export function queueRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', requireRole('FACTORY_OPERATOR', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { items, meta } = await queue.listQueue(listQueueQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.post('/:id/start', requireRole('FACTORY_OPERATOR'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { stationId } = startQueueSchema.parse(req.body);
    res.json({ data: await queue.startProcessing(req.user!, id, stationId, req.ip) });
  });
  router.post('/:id/complete', requireRole('FACTORY_OPERATOR'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { notes } = completeQueueSchema.parse(req.body);
    res.json({ data: await queue.completeProcessing(req.user!, id, notes, req.ip) });
  });
  return router;
}
