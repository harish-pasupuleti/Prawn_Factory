import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  completeInspectionSchema,
  inspectionCancelSchema,
  inspectionDecisionSchema,
  listInspectionsQuerySchema,
} from './schemas';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export function inspectionsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requireRole('FIELD_OFFICER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { items, meta } = await service.listInspections(req.user!, listInspectionsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });

  router.get('/:id', requireRole('FIELD_OFFICER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await service.getInspection(req.user!, id) });
  });

  router.post('/:id/start', requireRole('FIELD_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await service.startInspection(req.user!, id, req.ip) });
  });

  router.post('/:id/complete', requireRole('FIELD_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = completeInspectionSchema.parse(req.body);
    res.json({ data: await service.completeInspection(req.user!, id, input, req.ip) });
  });

  router.post('/:id/decision', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = inspectionDecisionSchema.parse(req.body);
    res.json({ data: await service.decideInspection(req.user!, id, input, req.ip) });
  });

  router.post('/:id/cancel', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = inspectionCancelSchema.parse(req.body);
    res.json({ data: await service.cancelInspection(req.user!, id, reason, req.ip) });
  });

  return router;
}
