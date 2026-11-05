-- AlterEnum
ALTER TYPE "ProcurementStatus" ADD VALUE 'RECEIVED';

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('RESERVED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('EXPECTED', 'ADMITTED', 'RECEIVED', 'RELEASED');

-- CreateEnum
CREATE TYPE "GateEventType" AS ENUM ('ARRIVED', 'VERIFIED', 'HELD', 'HOLD_RELEASED', 'REJECTED', 'OVERRIDE', 'ADMITTED', 'EXITED');

-- CreateEnum
CREATE TYPE "WeightKind" AS ENUM ('GROSS', 'TARE');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('RECEPTION_DISCREPANCY', 'GATE_REJECTION');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ExceptionEventType" AS ENUM ('RAISED', 'NOTE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "FactorySlot" (
    "id" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactorySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "collectionJobId" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'EXPECTED',
    "netWeightKg" DECIMAL(12,3),
    "receivedQuantityKg" DECIMAL(12,3),
    "receivedAt" TIMESTAMP(3),
    "receivedById" UUID,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotBooking" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedById" UUID NOT NULL,
    "reason" TEXT,
    "rescheduledFromId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateEvent" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "GateEventType" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightMeasurement" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "kind" "WeightKind" NOT NULL,
    "valueKg" DECIMAL(12,3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "supersedesId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCase" (
    "id" UUID NOT NULL,
    "type" "ExceptionType" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "shipmentId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "raisedById" UUID NOT NULL,
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExceptionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionEvent" (
    "id" UUID NOT NULL,
    "exceptionId" UUID NOT NULL,
    "type" "ExceptionEventType" NOT NULL,
    "actorId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingStation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'QUEUED',
    "stationId" UUID,
    "targetDurationMin" INTEGER NOT NULL,
    "releasedById" UUID NOT NULL,
    "startedById" UUID,
    "startedAt" TIMESTAMP(3),
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactorySlot_startsAt_idx" ON "FactorySlot"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactorySlot_startsAt_endsAt_key" ON "FactorySlot"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_code_key" ON "Shipment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_collectionJobId_key" ON "Shipment"("collectionJobId");

-- CreateIndex
CREATE INDEX "Shipment_requestId_idx" ON "Shipment"("requestId");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "SlotBooking_slotId_status_idx" ON "SlotBooking"("slotId", "status");

-- CreateIndex
CREATE INDEX "SlotBooking_shipmentId_createdAt_idx" ON "SlotBooking"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "GateEvent_shipmentId_createdAt_idx" ON "GateEvent"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "GateEvent_bookingId_idx" ON "GateEvent"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "WeightMeasurement_supersedesId_key" ON "WeightMeasurement"("supersedesId");

-- CreateIndex
CREATE INDEX "WeightMeasurement_shipmentId_kind_idx" ON "WeightMeasurement"("shipmentId", "kind");

-- CreateIndex
CREATE INDEX "ExceptionCase_status_createdAt_idx" ON "ExceptionCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ExceptionCase_shipmentId_idx" ON "ExceptionCase"("shipmentId");

-- CreateIndex
CREATE INDEX "ExceptionEvent_exceptionId_createdAt_idx" ON "ExceptionEvent"("exceptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingStation_name_key" ON "ProcessingStation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_shipmentId_key" ON "QueueEntry"("shipmentId");

-- CreateIndex
CREATE INDEX "QueueEntry_status_createdAt_idx" ON "QueueEntry"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FactorySlot" ADD CONSTRAINT "FactorySlot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_collectionJobId_fkey" FOREIGN KEY ("collectionJobId") REFERENCES "CollectionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotBooking" ADD CONSTRAINT "SlotBooking_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotBooking" ADD CONSTRAINT "SlotBooking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "FactorySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotBooking" ADD CONSTRAINT "SlotBooking_reservedById_fkey" FOREIGN KEY ("reservedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "SlotBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateEvent" ADD CONSTRAINT "GateEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightMeasurement" ADD CONSTRAINT "WeightMeasurement_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "WeightMeasurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionEvent" ADD CONSTRAINT "ExceptionEvent_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "ExceptionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionEvent" ADD CONSTRAINT "ExceptionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "ProcessingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity rules that Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- Human-readable shipment codes (SH-YYYY-000001) are built from this sequence.
CREATE SEQUENCE "shipment_code_seq" START WITH 1 INCREMENT BY 1;

-- Sanity checks, enforced by the database as well as by Zod.
ALTER TABLE "FactorySlot"
  ADD CONSTRAINT "FactorySlot_ends_after_starts" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "FactorySlot_capacity_positive" CHECK ("capacity" >= 1);
ALTER TABLE "WeightMeasurement"
  ADD CONSTRAINT "WeightMeasurement_valueKg_nonnegative" CHECK ("valueKg" >= 0);
ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_netWeightKg_nonnegative" CHECK ("netWeightKg" IS NULL OR "netWeightKg" >= 0),
  ADD CONSTRAINT "Shipment_receivedQuantityKg_nonnegative" CHECK ("receivedQuantityKg" IS NULL OR "receivedQuantityKg" >= 0);
ALTER TABLE "QueueEntry"
  ADD CONSTRAINT "QueueEntry_targetDurationMin_positive" CHECK ("targetDurationMin" > 0);

-- A shipment can have at most ONE active booking at a time (reschedule = old becomes RESCHEDULED, new is RESERVED).
CREATE UNIQUE INDEX "slot_booking_one_active_per_shipment"
  ON "SlotBooking" ("shipmentId")
  WHERE "status" IN ('RESERVED', 'CHECKED_IN');

-- Exactly one ORIGINAL (not a correction) measurement per kind and shipment; corrections chain through supersedesId,
-- which is itself unique, so a measurement can be corrected only once (the chain never forks).
CREATE UNIQUE INDEX "weight_measurement_one_original_per_kind"
  ON "WeightMeasurement" ("shipmentId", "kind")
  WHERE "supersedesId" IS NULL;

-- At most one OPEN exception of each type per shipment.
CREATE UNIQUE INDEX "exception_one_open_per_type_and_shipment"
  ON "ExceptionCase" ("shipmentId", "type")
  WHERE "status" = 'OPEN';

-- A processing station can run only one entry at a time.
CREATE UNIQUE INDEX "queue_entry_one_running_per_station"
  ON "QueueEntry" ("stationId")
  WHERE "status" = 'IN_PROGRESS';

-- Gate events, weight measurements and exception history are append-only (function created in the Phase 4 migration).
CREATE TRIGGER "GateEvent_append_only"
  BEFORE UPDATE OR DELETE ON "GateEvent"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();

CREATE TRIGGER "WeightMeasurement_append_only"
  BEFORE UPDATE OR DELETE ON "WeightMeasurement"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();

CREATE TRIGGER "ExceptionEvent_append_only"
  BEFORE UPDATE OR DELETE ON "ExceptionEvent"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();
