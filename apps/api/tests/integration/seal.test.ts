import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  app, arrivedShipment, assignedCollection, bearer, createFactoryStaff, createStaff, createVehicle, get, post, uploadPhoto,
  type FactoryStaff, type Staff,
} from './helpers';

let staff: Staff;
let fs: FactoryStaff;
beforeAll(async () => {
  staff = await createStaff();
  fs = await createFactoryStaff();
});

const gate = (bookingId: string, step: string, body: Record<string, unknown> = {}) => post(fs.securityToken, `/bookings/${bookingId}/${step}`, body);

async function loadedCollection() {
  const v = await createVehicle();
  const r = await assignedCollection(staff, v.id);
  const base = `/collections/${r.collectionId}`;
  await post(r.driverToken, `${base}/pickup`);
  await post(r.driverToken, `${base}/load`, { collectedQuantityKg: '400', notes: 'Collected as agreed with the farmer' });
  return { ...r, base };
}

describe('field photos and seal', () => {
  it('only the inspecting field officer can add photos, and only while the vehicle is at the farm', async () => {
    const v = await createVehicle();
    const r = await assignedCollection(staff, v.id);
    expect((await uploadPhoto(staff.officerToken, r.collectionId)).status).toBe(409); // not picked up yet
    await post(r.driverToken, `/collections/${r.collectionId}/pickup`);
    expect((await uploadPhoto(staff.otherOfficerToken, r.collectionId)).status).toBe(404); // a different field officer
    expect((await uploadPhoto(r.driverToken, r.collectionId)).status).toBe(403);
    expect((await uploadPhoto(staff.officerToken, r.collectionId)).status).toBe(201);
  });

  it('rejects files that are not images', async () => {
    const r = await loadedCollection();
    const res = await request(app).post(`/api/v1/collections/${r.collectionId}/photos`).set(bearer(staff.officerToken)).attach('photos', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMAGE');
  });

  it('the purchase manager can see the photos; the seal code is for the field officer and manager only', async () => {
    const r = await loadedCollection();
    await uploadPhoto(staff.officerToken, r.collectionId);
    const seen = await get(staff.managerToken, `/collections/${r.collectionId}`);
    expect(seen.body.data.photos).toHaveLength(1);
    const photoId = seen.body.data.photos[0].id as string;
    const image = await get(staff.managerToken, `/collections/${r.collectionId}/photos/${photoId}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');

    const sealed = await post(staff.officerToken, `${r.base}/seal`);
    expect(sealed.status).toBe(200);
    expect(sealed.body.data.sealCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await get(staff.managerToken, `/collections/${r.collectionId}`)).body.data.sealCode).toBe(sealed.body.data.sealCode);

    const asDriver = await get(r.driverToken, `/collections/${r.collectionId}`);
    expect(asDriver.body.data.sealed).toBe(true);
    expect(asDriver.body.data.sealCode).toBeNull();
    expect((await get(staff.otherOfficerToken, `/collections/${r.collectionId}`)).status).toBe(404);

    expect((await post(staff.officerToken, `${r.base}/seal`)).status).toBe(409); // already sealed
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'collection.seal', entityId: r.collectionId } });
    expect(JSON.stringify(audit)).not.toContain(sealed.body.data.sealCode.replace('-', ''));
  });

  it('needs a photo and a loaded vehicle before sealing', async () => {
    const r = await loadedCollection();
    const res = await post(staff.officerToken, `${r.base}/seal`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHOTOS_REQUIRED');
  });
});

describe('seal check at the gate', () => {
  it('the security officer never sees the code; a wrong code is refused and recorded, the right one verifies', async () => {
    const a = await arrivedShipment(staff);
    await gate(a.bookingId, 'arrive');
    const list = await get(fs.securityToken, '/bookings');
    expect(JSON.stringify(list.body)).not.toContain(a.sealCode.replace('-', ''));
    expect(list.body.data.find((b: { id: string }) => b.id === a.bookingId).sealRequired).toBe(true);

    const plate = a.vehicle.registrationNumber;
    const missing = await gate(a.bookingId, 'verify', { registrationNumber: plate });
    expect(missing.body.error.code).toBe('SEAL_CODE_REQUIRED');
    const wrong = await gate(a.bookingId, 'verify', { registrationNumber: plate, sealCode: 'AAAA-AAAA' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('SEAL_MISMATCH');
    expect(await prisma.gateEvent.count({ where: { bookingId: a.bookingId, type: 'SEAL_MISMATCH' } })).toBe(1);
    expect(await prisma.gateEvent.count({ where: { bookingId: a.bookingId, type: 'VERIFIED' } })).toBe(0);

    const typedLoosely = a.sealCode.toLowerCase().replace('-', ' ');
    expect((await gate(a.bookingId, 'verify', { registrationNumber: plate, sealCode: typedLoosely })).status).toBe(200);
  });

  it('pauses verification after too many wrong codes', async () => {
    const a = await arrivedShipment(staff);
    await gate(a.bookingId, 'arrive');
    const body = { registrationNumber: a.vehicle.registrationNumber, sealCode: 'AAAA-AAAA' };
    for (let i = 0; i < 5; i += 1) expect((await gate(a.bookingId, 'verify', body)).body.error.code).toBe('SEAL_MISMATCH');
    const locked = await gate(a.bookingId, 'verify', { ...body, sealCode: a.sealCode });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('SEAL_LOCKED');
  });
});
