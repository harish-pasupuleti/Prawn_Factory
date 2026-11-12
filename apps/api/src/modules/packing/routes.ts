import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { addBoxesSchema, approvePackingSchema, assignIdsSchema, boxPlanSchema, listPackingQuerySchema, voidBoxSchema } from './schemas';
import * as service from './service';

const shipmentParam = z.object({ shipmentId: z.string().uuid() });
const boxParam = z.object({ shipmentId: z.string().uuid(), boxId: z.string().uuid() });
const requestParam = z.object({ requestId: z.string().uuid() });

const VIEWERS = ['FACTORY_OPERATOR', 'PURCHASE_MANAGER', 'ADMIN'] as const;

export function packingRouter(): Router {
  const router = Router();
  router.use(authenticate);

  // Box requirements of a purchase order. The purchase manager sets them; the factory reads them while packing.
  router.get('/plans/:requestId', requireRole(...VIEWERS), async (req, res) => {
    const { requestId } = requestParam.parse(req.params);
    res.json({ data: await service.getBoxPlan(requestId) });
  });
  router.put('/plans/:requestId', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { requestId } = requestParam.parse(req.params);
    res.json({ data: await service.setBoxPlan(req.user!, requestId, boxPlanSchema.parse(req.body), req.ip) });
  });

  router.get('/', requireRole(...VIEWERS), async (req, res) => {
    const { items, meta } = await service.listPacking(listPackingQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.get('/:shipmentId', requireRole(...VIEWERS), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    res.json({ data: await service.getPacking(shipmentId) });
  });

  router.post('/:shipmentId/boxes', requireRole('FACTORY_OPERATOR'), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    res.status(201).json({ data: await service.addBoxes(req.user!, shipmentId, addBoxesSchema.parse(req.body), req.ip) });
  });
  router.post('/:shipmentId/assign-ids', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    const { boxIds } = assignIdsSchema.parse(req.body ?? {});
    res.json({ data: await service.assignBoxIds(req.user!, shipmentId, boxIds, req.ip) });
  });
  router.post('/:shipmentId/boxes/:boxId/void', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { shipmentId, boxId } = boxParam.parse(req.params);
    res.json({ data: await service.voidBox(req.user!, shipmentId, boxId, voidBoxSchema.parse(req.body).reason, req.ip) });
  });
  router.post('/:shipmentId/approve', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    res.json({ data: await service.approvePacking(req.user!, shipmentId, approvePackingSchema.parse(req.body ?? {}).note, req.ip) });
  });

  return router;
}
