import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest } from '../../lib/errors';
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
import { addPhotos, getPhoto, sealLoad } from './evidence';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });
const photoParam = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });
const captionSchema = z.object({ caption: z.string().trim().max(200).optional() });

// Photos are held in memory just long enough to validate and store them. The browser shrinks them first.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 4, fields: 2 } });
const acceptPhotos: RequestHandler = (req, res, next) => {
  upload.array('photos', 4)(req, res, (err: unknown) => {
    if (!err) return next();
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    next(badRequest(tooBig ? 'PHOTO_TOO_LARGE' : 'INVALID_UPLOAD', tooBig ? 'Each photo must be 4 MB or smaller' : 'Upload up to 4 photos at a time'));
  });
};

const VIEWERS = ['TRANSPORT_OFFICER', 'FIELD_OFFICER', 'PURCHASE_MANAGER', 'ADMIN'] as const;

export function collectionsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requireRole(...VIEWERS), async (req, res) => {
    const { items, meta } = await service.listCollections(req.user!, listCollectionsQuerySchema.parse(req.query));
    res.json({ data: items, meta });
  });

  router.get('/:id', requireRole(...VIEWERS), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await service.getCollection(req.user!, id) });
  });

  // Photo bytes. Photos are immutable, so the browser may cache them privately.
  router.get('/:id/photos/:photoId', requireRole(...VIEWERS), async (req, res) => {
    const { id, photoId } = photoParam.parse(req.params);
    const photo = await getPhoto(req.user!, id, photoId);
    res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(photo.data));
  });

  // Field officer: photos from the farm, then seal the load.
  router.post('/:id/photos', requireRole('FIELD_OFFICER'), acceptPhotos, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { caption } = captionSchema.parse(req.body ?? {});
    const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({ buffer: f.buffer, size: f.size }));
    res.status(201).json({ data: await addPhotos(req.user!, id, files, caption, req.ip) });
  });

  router.post('/:id/seal', requireRole('FIELD_OFFICER'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ data: await sealLoad(req.user!, id, req.ip) });
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
