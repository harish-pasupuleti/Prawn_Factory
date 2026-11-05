import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { createVehicleSchema, listVehiclesQuerySchema, updateVehicleSchema } from './schemas';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export function vehiclesRouter(): Router {
  const router = Router();
  router.use(authenticate);

  // The Purchase Manager needs the list to assign transport; only the Administrator manages vehicles.
  router.get('/', requireRole('ADMIN', 'PURCHASE_MANAGER'), async (req, res) => {
    const { items, meta } = await service.listVehicles(listVehiclesQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });

  router.post('/', requireRole('ADMIN'), async (req, res) => {
    const input = createVehicleSchema.parse(req.body);
    res.status(201).json({ data: await service.createVehicle(req.user!.id, input, req.ip) });
  });

  router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const input = updateVehicleSchema.parse(req.body);
    res.json({ data: await service.updateVehicle(req.user!.id, id, input, req.ip) });
  });

  return router;
}
