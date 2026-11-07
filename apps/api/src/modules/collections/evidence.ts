import { randomInt } from 'node:crypto';
import { recordAudit } from '../../lib/audit';
import { badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { lockRequest } from '../../lib/locks';
import { prisma, type Tx } from '../../lib/prisma';
import type { AuthUser } from '../../types/express';
import { detectImageType, generateSealCode, MAX_PHOTOS_PER_JOB, MIN_PHOTOS_TO_SEAL, PHOTO_STATUSES } from './rules';
import { getCollection, scopeFor } from './service';

/** The field officer who inspected the request is the one who goes to the farm with the transport officer. */
async function loadJobForFieldOfficer(tx: Tx, actor: AuthUser, id: string) {
  const ref = await tx.collectionJob.findFirst({
    where: { id, request: { inspections: { some: { officerId: actor.id, status: 'COMPLETED' } } } },
    select: { requestId: true },
  });
  if (!ref) throw notFound('Collection job not found');
  await lockRequest(tx, ref.requestId);
  return tx.collectionJob.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, sealedAt: true, _count: { select: { photos: true } } } });
}

export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

/** Field officer adds photos taken at the farm. */
export async function addPhotos(actor: AuthUser, id: string, files: UploadedPhoto[], caption: string | undefined, ip: string | undefined) {
  if (files.length === 0) throw badRequest('NO_PHOTOS', 'Choose at least one photo');
  const prepared = files.map((f) => {
    const mimeType = detectImageType(f.buffer);
    if (!mimeType) throw badRequest('INVALID_IMAGE', 'Only JPEG, PNG or WebP photos can be uploaded');
    return { mimeType, sizeBytes: f.size, data: f.buffer };
  });

  await prisma.$transaction(async (tx) => {
    const job = await loadJobForFieldOfficer(tx, actor, id);
    if (!PHOTO_STATUSES.includes(job.status)) {
      throw conflict('INVALID_STATE', 'Photos can be added once the transport officer has picked up, and until the vehicle is dispatched');
    }
    if (job.sealedAt) throw conflict('ALREADY_SEALED', 'The load is already sealed, so no more photos can be added');
    if (job._count.photos + prepared.length > MAX_PHOTOS_PER_JOB) {
      throw conflict('TOO_MANY_PHOTOS', `A collection can have at most ${MAX_PHOTOS_PER_JOB} photos`);
    }
    await tx.collectionPhoto.createMany({
      data: prepared.map((p) => ({ collectionJobId: id, uploadedById: actor.id, caption: caption ?? null, ...p })),
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'collection.photos_added',
      entityType: 'CollectionJob',
      entityId: id,
      after: { added: prepared.length, totalBytes: prepared.reduce((n, p) => n + p.sizeBytes, 0) },
      ip,
    });
  });
  return getCollection(actor, id);
}

/** Field officer seals the loaded vehicle. The server generates the code; it is shown to the field officer and purchase manager only. */
export async function sealLoad(actor: AuthUser, id: string, ip: string | undefined) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const job = await loadJobForFieldOfficer(tx, actor, id);
        if (job.sealedAt) throw conflict('ALREADY_SEALED', 'This load is already sealed');
        if (job.status !== 'LOADED') throw conflict('INVALID_STATE', 'The load can be sealed once the transport officer has loaded the vehicle');
        if (job._count.photos < MIN_PHOTOS_TO_SEAL) {
          throw conflict('PHOTOS_REQUIRED', `Upload at least ${MIN_PHOTOS_TO_SEAL} photo${MIN_PHOTOS_TO_SEAL === 1 ? '' : 's'} before sealing the load`);
        }
        await tx.collectionJob.update({
          where: { id },
          data: { sealCode: generateSealCode((max) => randomInt(max)), sealedAt: new Date(), sealedById: actor.id },
        });
        // The code itself is deliberately not written to the audit log.
        await recordAudit(tx, { actorId: actor.id, action: 'collection.seal', entityType: 'CollectionJob', entityId: id, after: { photos: job._count.photos }, ip });
      });
      return getCollection(actor, id);
    } catch (err) {
      // Two loads drawing the same random code is vanishingly rare; draw again.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw conflict('SEAL_RETRY', 'Could not generate a seal code. Please try again');
}

/** Streams one photo to anyone allowed to see this collection job. */
export async function getPhoto(actor: AuthUser, id: string, photoId: string) {
  const photo = await prisma.collectionPhoto.findFirst({
    where: { id: photoId, collectionJobId: id, collectionJob: scopeFor(actor) },
    select: { mimeType: true, data: true },
  });
  if (!photo) throw notFound('Photo not found');
  return photo;
}
