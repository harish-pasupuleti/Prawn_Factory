# API reference (v1)

Base path `/api/v1`. JSON in, JSON out. Success: `{ "data": ..., "meta"?: { page, pageSize, total, totalPages } }`.
Errors: `{ "error": { "code", "message", "details"?, "requestId" } }`.
Authenticated routes need `Authorization: Bearer <accessToken>`. Cookie routes (`/auth/refresh`, `/auth/logout`) also need the header `X-Requested-With: XMLHttpRequest`.
Decimal values (kg, ₹) are exact strings, for example `"1250.500"`. Dates are `YYYY-MM-DD`. All request bodies reject unknown fields.
An OpenAPI/Swagger document is not generated yet.

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness and database check |
| POST | `/auth/register` | public (rate limited) | Farmer self-registration |
| POST | `/auth/login` | public (rate limited) | Returns access token; sets refresh cookie |
| POST | `/auth/refresh` | cookie | Rotates refresh token, returns new access token |
| POST | `/auth/logout` | cookie | Revokes current session |
| GET | `/auth/me` | any signed-in | Current user (+ farmer profile) |
| POST | `/users` | Admin | Create staff account (not farmers) |
| GET | `/users` | Admin | List; filters `role`, `status`, `q`; `page`, `pageSize` |
| PATCH | `/users/:id` | Admin | Change name, role, status (not self; farmers cannot become staff) |
| POST | `/procurement` | Farmer | Submit request |
| GET | `/procurement` | Farmer (own), Purchase Mgr, Admin | List; filters `status`, `q` (code); `sort` = createdAt, code, status; `order`; paging |
| GET | `/procurement/stats` | Farmer (own), Purchase Mgr, Admin | Counts by status |
| GET | `/procurement/:id` | Farmer (own), Purchase Mgr, Admin | Detail with original, current, amendments |
| POST | `/procurement/:id/decision` | Purchase Mgr | `{ decision: APPROVE | REJECT | REQUEST_CLARIFICATION, reason? }` (reason required unless APPROVE) |
| POST | `/procurement/:id/cancel` | Farmer (own), Purchase Mgr | `{ reason }` |
| POST | `/procurement/:id/resubmit` | Farmer (own) | From CLARIFICATION_REQUESTED back to SUBMITTED |
| POST | `/procurement/:id/amendments` | Purchase Mgr | `{ field, newValue, reason }` while SUBMITTED or CLARIFICATION_REQUESTED |
| POST | `/procurement/:id/inspections` | Purchase Mgr | `{ officerId }` on an APPROVED request |
| POST | `/procurement/:id/collections` | Purchase Mgr | `{ transportOfficerId, vehicleId, scheduledPickupAt?, expectedArrivalAt? }` (ISO date-times) on an INSPECTION_PASSED request |
| GET | `/inspections` | Field Officer (own), Purchase Mgr, Admin | Filters `status`, `outcome`; paging |
| GET | `/inspections/:id` | same | Detail (no farmer price) |
| POST | `/inspections/:id/start` | Field Officer (assigned) | ASSIGNED → IN_PROGRESS |
| POST | `/inspections/:id/complete` | Field Officer (assigned) | `{ outcome: PASS\|FAIL\|REVIEW, observedSpecies, observedSizeCount, inspectedQuantityKg, qualityNotes, discrepancyNotes? }` |
| POST | `/inspections/:id/decision` | Purchase Mgr | `{ decision: PROCEED\|REJECT\|REINSPECT, reason }` on a FAIL / REVIEW inspection, once |
| POST | `/inspections/:id/cancel` | Purchase Mgr | `{ reason }` before completion; request returns to APPROVED |
| GET | `/collections`, `/collections/:id` | Transport Officer (own), Purchase Mgr, Admin | Filter `status`; paging |
| POST | `/collections/:id/pickup` | Transport Officer (assigned) | ASSIGNED → PICKED_UP |
| POST | `/collections/:id/load` | Transport Officer (assigned) | `{ collectedQuantityKg, notes? }`; ≤ vehicle capacity; note required if far from inspected quantity |
| GET | `/collections/:id/photos/:photoId` | Field Officer (own), Transport (own), Purchase Mgr, Admin | Photo bytes (cacheable, private) |
| POST | `/collections/:id/photos` | Field Officer (inspected the request) | multipart `photos` (up to 4 per call, 4 MB each, 8 per job); only while PICKED_UP or LOADED and not yet sealed |
| POST | `/collections/:id/seal` | Field Officer (inspected the request) | LOADED job with at least one photo. The server generates the code (returned to the field officer and purchase manager only) |
| POST | `/collections/:id/dispatch` | Transport Officer (assigned) | `{ expectedArrivalAt? }` (required here if not set at assignment); request becomes IN_TRANSIT. Refused with `SEAL_REQUIRED` until the field officer has sealed the load |
| POST | `/collections/:id/arrive` | Transport Officer (assigned) | DISPATCHED → ARRIVED |
| POST | `/collections/:id/handover` | Transport Officer (assigned) | `{ notes? }`; request becomes DELIVERED |
| POST | `/collections/:id/incidents` | Transport Officer (assigned) | `{ type, description, quantityAffectedKg? }` on an active job |
| POST | `/collections/:id/cancel` | Purchase Mgr | `{ reason }` before dispatch; request returns to INSPECTION_PASSED |
| GET | `/vehicles` | Admin, Purchase Mgr | Filter `active`; includes `busy` |
| POST / PATCH | `/vehicles`, `/vehicles/:id` | Admin | Create; update capacity / description / `isActive` (not while on a job) |
| GET | `/assignees?role=FIELD_OFFICER\|TRANSPORT_OFFICER` | Purchase Mgr | Active staff with id, name and open workload only |

## Procurement status transitions

```
SUBMITTED ─► APPROVED ─► INSPECTION_ASSIGNED ─► INSPECTION_PASSED ─► TRANSPORT_ASSIGNED ─► IN_TRANSIT ─► DELIVERED ─► RECEIVED
   │  ▲            ▲              │ ├──────────► INSPECTION_FAILED ──┐        │ (collection cancelled)
   │  │            │              │ └──────────► INSPECTION_REVIEW ──┤        └──► back to INSPECTION_PASSED
   │  └ resubmit   │              └ (assignment cancelled) ► APPROVED │
   ├─► CLARIFICATION_REQUESTED    FAIL / REVIEW need a manager decision recorded with a reason:
   ├─► REJECTED  (terminal)         PROCEED ► INSPECTION_PASSED · REINSPECT ► APPROVED · REJECT ► REJECTED
   └─► CANCELLED (terminal; possible until IN_TRANSIT; cancels any open inspection / collection job)
```

Only INSPECTION_PASSED can move to TRANSPORT_ASSIGNED. Collection jobs run ASSIGNED → PICKED_UP → LOADED → DISPATCHED → ARRIVED → HANDED_OVER and can be cancelled only before dispatch.
Shipments: EXPECTED → ADMITTED (gate) → RECEIVED → RELEASED (queued). Bookings: RESERVED → CHECKED_IN → COMPLETED, or CANCELLED / RESCHEDULED / NO_SHOW. Queue: QUEUED → IN_PROGRESS → COMPLETED.
Invalid transitions return `409 INVALID_TRANSITION`. Every mutation of a request, its inspections and its collection jobs runs under a row lock on the request (`SELECT ... FOR UPDATE`), so simultaneous conflicting actions cannot both succeed.

## Error codes

`VALIDATION_ERROR` 400, `TARE_EXCEEDS_GROSS` 400, `PLATE_MISMATCH` 400, `DISCREPANCY_NOTES_REQUIRED` 400, `NOTES_REQUIRED` 400, `EXCEEDS_VEHICLE_CAPACITY` 400, `EXPECTED_ARRIVAL_REQUIRED` 400, `INVALID_ASSIGNEE` 400, `INVALID_VEHICLE` 400, `INVALID_JSON` 400, `NO_CHANGE` 400, `ROLE_CHANGE_NOT_ALLOWED` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `INVALID_TRANSITION` 409, `SLOT_FULL` 409, `SLOT_UNAVAILABLE` 409, `SLOT_EXISTS` 409, `CAPACITY_BELOW_BOOKINGS` 409, `ALREADY_BOOKED` 409, `JOB_NOT_ACTIVE` 409, `INVALID_GATE_ACTION` 409, `OUTSIDE_WINDOW` 409, `VEHICLE_NOT_DISPATCHED` 409, `WEIGHING_INCOMPLETE` 409, `HANDOVER_REQUIRED` 409, `NOT_ADMITTED` 409, `ALREADY_RECORDED` 409, `EXCEPTION_OPEN` 409, `ALREADY_RESOLVED` 409, `STATION_BUSY` 409, `STATION_EXISTS` 409, `ASSIGNMENT_CONFLICT` 409, `OFFICER_BUSY` 409, `VEHICLE_BUSY` 409, `VEHICLE_EXISTS` 409, `DECISION_NOT_APPLICABLE` 409, `ALREADY_DECIDED` 409, `CANCEL_NOT_ALLOWED` 409, `INVALID_STATE` 409, `AMENDMENT_NOT_ALLOWED` 409, `DUPLICATE_REQUEST` 409, `EMAIL_TAKEN` 409, `CANNOT_MODIFY_SELF` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500.

## Audit actions recorded

`auth.register`, `auth.login`, `auth.login_failed`, `auth.account_locked`, `auth.refresh_reuse_detected`, `auth.logout`, `user.create`, `user.update`, `user.access_change`, `admin.seed`, `procurement.submit`, `procurement.approve`, `procurement.reject`, `procurement.request_clarification`, `procurement.resubmit`, `procurement.cancel`, `procurement.amend`, `inspection.assign`, `inspection.start`, `inspection.complete`, `inspection.decision`, `inspection.cancel`, `collection.assign`, `collection.pickup`, `collection.load`, `collection.dispatch`, `collection.arrive`, `collection.handover`, `collection.photos_added`, `collection.seal`, `collection.incident`, `collection.cancel`, `vehicle.create`, `vehicle.update`, `slot.create`, `slot.update`, `booking.create`, `booking.reschedule`, `booking.cancel`, `booking.no_show`, `gate.arrive`, `gate.verify`, `gate.seal_mismatch`, `gate.hold`, `gate.releaseHold`, `gate.reject`, `gate.override`, `gate.admit`, `gate.exit`, `weight.record`, `weight.correct`, `shipment.receive`, `shipment.release`, `exception.raise`, `exception.note`, `exception.resolve`, `station.create`, `station.update`, `processing.start`, `processing.complete`.
