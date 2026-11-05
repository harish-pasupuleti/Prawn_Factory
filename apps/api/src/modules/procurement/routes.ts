import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  amendSchema,
  cancelSchema,
  createRequestSchema,
  decisionSchema,
  idParamSchema,
  listQuerySchema,
  resubmitSchema,
} from './schemas';
import { assignInspectionSchema } from '../inspections/schemas';
import * as inspections from '../inspections/service';
import { assignBothSchema, assignTransportSchema } from '../collections/schemas';
import * as collections from '../collections/service';
import { assignFieldAndTransport } from './assignments';
import * as service from './service';

export function procurementRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/', requireRole('FARMER'), async (req, res) => {
    const input = createRequestSchema.parse(req.body);
    res.status(201).json({ data: await service.submitRequest(req.user!, input, req.ip) });
  });

  router.get('/', requireRole('FARMER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { items, meta } = await service.listRequests(req.user!, listQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });

  router.get('/stats', requireRole('FARMER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    res.json({ data: await service.requestStats(req.user!) });
  });

  router.get('/:id', requireRole('FARMER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ data: await service.getRequest(req.user!, id) });
  });

  router.post('/:id/decision', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = decisionSchema.parse(req.body);
    res.json({ data: await service.decideRequest(req.user!, id, input, req.ip) });
  });

  router.post('/:id/cancel', requireRole('FARMER', 'PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { reason } = cancelSchema.parse(req.body);
    res.json({ data: await service.cancelRequest(req.user!, id, reason, req.ip) });
  });

  router.post('/:id/resubmit', requireRole('FARMER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { note } = resubmitSchema.parse(req.body);
    res.json({ data: await service.resubmitRequest(req.user!, id, note, req.ip) });
  });

  router.post('/:id/amendments', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = amendSchema.parse(req.body);
    res.status(201).json({ data: await service.amendRequest(req.user!, id, input, req.ip) });
  });

  // Purchase Manager only: assign a field officer and transport (separately, or together via /assignments).
  router.post('/:id/inspections', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { officerId } = assignInspectionSchema.parse(req.body);
    res.status(201).json({ data: await inspections.assignInspection(req.user!, id, officerId, req.ip) });
  });

  // Field officer + transport in one step, so transport does not wait for the inspection.
  router.post('/:id/assignments', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = assignBothSchema.parse(req.body);
    res.status(201).json({ data: await assignFieldAndTransport(req.user!, id, input, req.ip) });
  });

  router.post('/:id/collections', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = assignTransportSchema.parse(req.body);
    res.status(201).json({ data: await collections.assignTransport(req.user!, id, input, req.ip) });
  });

  return router;
}
