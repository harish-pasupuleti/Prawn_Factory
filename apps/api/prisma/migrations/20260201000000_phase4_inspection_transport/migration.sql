-- AlterEnum
ALTER TYPE "ProcurementStatus" ADD VALUE 'INSPECTION_ASSIGNED';
ALTER TYPE "ProcurementStatus" ADD VALUE 'INSPECTION_PASSED';
ALTER TYPE "ProcurementStatus" ADD VALUE 'INSPECTION_FAILED';
ALTER TYPE "ProcurementStatus" ADD VALUE 'INSPECTION_REVIEW';
ALTER TYPE "ProcurementStatus" ADD VALUE 'TRANSPORT_ASSIGNED';
ALTER TYPE "ProcurementStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "ProcurementStatus" ADD VALUE 'DELIVERED';

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionOutcome" AS ENUM ('PASS', 'FAIL', 'REVIEW');

-- CreateEnum
CREATE TYPE "InspectionDecisionKind" AS ENUM ('PROCEED', 'REJECT', 'REINSPECT');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED', 'HANDED_OVER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('DELAY', 'DAMAGE', 'QUANTITY_SHORTFALL', 'VEHICLE_BREAKDOWN', 'OTHER');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "description" TEXT,
    "capacityKg" DECIMAL(12,3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldInspection" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "officerId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcome" "InspectionOutcome",
    "observedSpecies" TEXT,
    "observedSizeCount" TEXT,
    "inspectedQuantityKg" DECIMAL(12,3),
    "declaredQuantityKgAtInspection" DECIMAL(12,3),
    "quantityVariancePct" DECIMAL(12,2),
    "qualityNotes" TEXT,
    "discrepancyNotes" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionDecision" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "kind" "InspectionDecisionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionJob" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "transportOfficerId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "status" "CollectionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledPickupAt" TIMESTAMP(3),
    "expectedArrivalAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "loadedAt" TIMESTAMP(3),
    "collectedQuantityKg" DECIMAL(12,3),
    "collectionNotes" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "handoverNotes" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionIncident" (
    "id" UUID NOT NULL,
    "collectionJobId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "description" TEXT NOT NULL,
    "quantityAffectedKg" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_registrationNumber_key" ON "Vehicle"("registrationNumber");

-- CreateIndex
CREATE INDEX "FieldInspection_requestId_createdAt_idx" ON "FieldInspection"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "FieldInspection_officerId_status_idx" ON "FieldInspection"("officerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionDecision_inspectionId_key" ON "InspectionDecision"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionDecision_requestId_idx" ON "InspectionDecision"("requestId");

-- CreateIndex
CREATE INDEX "CollectionJob_requestId_createdAt_idx" ON "CollectionJob"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionJob_transportOfficerId_status_idx" ON "CollectionJob"("transportOfficerId", "status");

-- CreateIndex
CREATE INDEX "CollectionJob_vehicleId_status_idx" ON "CollectionJob"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "CollectionIncident_collectionJobId_createdAt_idx" ON "CollectionIncident"("collectionJobId", "createdAt");

-- AddForeignKey
ALTER TABLE "FieldInspection" ADD CONSTRAINT "FieldInspection_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldInspection" ADD CONSTRAINT "FieldInspection_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldInspection" ADD CONSTRAINT "FieldInspection_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionDecision" ADD CONSTRAINT "InspectionDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionDecision" ADD CONSTRAINT "InspectionDecision_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "FieldInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionDecision" ADD CONSTRAINT "InspectionDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_transportOfficerId_fkey" FOREIGN KEY ("transportOfficerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionIncident" ADD CONSTRAINT "CollectionIncident_collectionJobId_fkey" FOREIGN KEY ("collectionJobId") REFERENCES "CollectionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionIncident" ADD CONSTRAINT "CollectionIncident_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity rules that Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- Measurement sanity, enforced by the database as well as by Zod.
ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_capacityKg_positive" CHECK ("capacityKg" > 0);
ALTER TABLE "FieldInspection"
  ADD CONSTRAINT "FieldInspection_inspectedQuantityKg_nonnegative" CHECK ("inspectedQuantityKg" IS NULL OR "inspectedQuantityKg" >= 0);
ALTER TABLE "CollectionJob"
  ADD CONSTRAINT "CollectionJob_collectedQuantityKg_positive" CHECK ("collectedQuantityKg" IS NULL OR "collectedQuantityKg" > 0);
ALTER TABLE "CollectionIncident"
  ADD CONSTRAINT "CollectionIncident_quantityAffectedKg_positive" CHECK ("quantityAffectedKg" IS NULL OR "quantityAffectedKg" > 0);

-- At most ONE active inspection per request.
CREATE UNIQUE INDEX "field_inspection_one_active_per_request"
  ON "FieldInspection" ("requestId")
  WHERE "status" IN ('ASSIGNED', 'IN_PROGRESS');

-- At most ONE active collection job per request, per vehicle and per transport officer.
CREATE UNIQUE INDEX "collection_job_one_active_per_request"
  ON "CollectionJob" ("requestId")
  WHERE "status" IN ('ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED');
CREATE UNIQUE INDEX "collection_job_one_active_per_vehicle"
  ON "CollectionJob" ("vehicleId")
  WHERE "status" IN ('ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED');
CREATE UNIQUE INDEX "collection_job_one_active_per_officer"
  ON "CollectionJob" ("transportOfficerId")
  WHERE "status" IN ('ASSIGNED', 'PICKED_UP', 'LOADED', 'DISPATCHED', 'ARRIVED');

-- The duplicate-submission guard from Phase 3 must keep working once a request moves beyond APPROVED:
-- any request that is not terminal still counts as "open".
DROP INDEX "procurement_open_duplicate_uniq";
CREATE UNIQUE INDEX "procurement_open_duplicate_uniq"
  ON "ProcurementRequest" ("farmerId", "species", "declaredSizeCount", "declaredQuantityKg", "availabilityDate")
  WHERE "status" NOT IN ('REJECTED', 'CANCELLED');

-- Decisions and incidents are append-only, like the audit log.
CREATE FUNCTION "append_only_guard"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InspectionDecision_append_only"
  BEFORE UPDATE OR DELETE ON "InspectionDecision"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();

CREATE TRIGGER "CollectionIncident_append_only"
  BEFORE UPDATE OR DELETE ON "CollectionIncident"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();
