import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  arriveSchema,
  collectionCancelSchema,
  dispatchSchema,
  handoverSchema,
  incidentSchema,
  listCollectionsQuerySchema,
  loadSchema,
} from './schemas';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export function collectionsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requireRole('TRANSPORT_OFFICER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { items, meta } = await service.listCollections(req.user!, listCollectionsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });

  router.get('/:id', requireRole('TRANSPORT_OFFICER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await service.getCollection(req.user!, id) });
  });

  router.post('/:id/pickup', requireRole('TRANSPORT_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await service.pickup(req.user!, id, req.ip) });
  });

  router.post('/:id/load', requireRole('TRANSPORT_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = loadSchema.parse(req.body);
    res.json({ data: await service.load(req.user!, id, input, req.ip) });
  });

  router.post('/:id/dispatch', requireRole('TRANSPORT_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { expectedArrivalAt } = dispatchSchema.parse(req.body);
    res.json({ data: await service.dispatch(req.user!, id, expectedArrivalAt, req.ip) });
  });

  router.post('/:id/arrive', requireRole('TRANSPORT_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    arriveSchema.parse(req.body);
    res.json({ data: await service.arrive(req.user!, id, req.ip) });
  });

  router.post('/:id/handover', requireRole('TRANSPORT_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { notes } = handoverSchema.parse(req.body);
    res.json({ data: await service.handover(req.user!, id, notes, req.ip) });
  });

  router.post('/:id/incidents', requireRole('TRANSPORT_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = incidentSchema.parse(req.body);
    res.status(201).json({ data: await service.reportIncident(req.user!, id, input, req.ip) });
  });

  router.post('/:id/cancel', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = collectionCancelSchema.parse(req.body);
    res.json({ data: await service.cancelCollection(req.user!, id, reason, req.ip) });
  });

  return router;
}
