import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { decidePaymentSchema, listPaymentsQuerySchema, settlePaymentSchema } from './schemas';
import * as service from './service';

const shipmentParam = z.object({ shipmentId: z.string().uuid() });

export function paymentsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  // Farmers see their own deliveries and invoices; the purchase manager and administrator see all of them.
  router.get('/', requireRole('FARMER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { items, meta } = await service.listPayments(req.user!, listPaymentsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });
  router.get('/:shipmentId', requireRole('FARMER', 'PURCHASE_MANAGER', 'ADMIN'), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    res.json({ data: await service.getPayment(req.user!, shipmentId) });
  });

  router.post('/:shipmentId/decide', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    res.status(201).json({ data: await service.decidePayment(req.user!, shipmentId, decidePaymentSchema.parse(req.body), req.ip) });
  });
  router.post('/:shipmentId/settle', requireRole('PURCHASE_MANAGER'), async (req, res) => {
    const { shipmentId } = shipmentParam.parse(req.params);
    res.json({ data: await service.settlePayment(req.user!, shipmentId, settlePaymentSchema.parse(req.body ?? {}), req.ip) });
  });

  return router;
}
