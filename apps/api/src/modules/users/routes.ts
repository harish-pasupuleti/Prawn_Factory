import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { createUserSchema, idParamSchema, listUsersQuerySchema, updateUserSchema } from './schemas';
import * as service from './service';

export function usersRouter(): Router {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'));

  router.post('/', async (req, res) => {
    const input = createUserSchema.parse(req.body);
    res.status(201).json({ data: await service.createStaffUser(req.user!.id, input, req.ip) });
  });

  router.get('/', async (req, res) => {
    const { items, meta } = await service.listUsers(listUsersQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    res.json({ data: await service.updateUser(req.user!.id, id, input, req.ip) });
  });

  return router;
}
