-- Gate: a wrong seal code is recorded as its own event so the purchase manager can see it.
ALTER TYPE "GateEventType" ADD VALUE 'SEAL_MISMATCH';

-- Seal applied by the field officer after loading.
ALTER TABLE "CollectionJob"
  ADD COLUMN "sealCode" TEXT,
  ADD COLUMN "sealedAt" TIMESTAMP(3),
  ADD COLUMN "sealedById" UUID,
  ADD COLUMN "sealFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sealLastFailedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CollectionJob_sealCode_key" ON "CollectionJob"("sealCode");

ALTER TABLE "CollectionJob" ADD CONSTRAINT "CollectionJob_sealedById_fkey"
  FOREIGN KEY ("sealedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Photos taken at the farm.
CREATE TABLE "CollectionPhoto" (
  "id" UUID NOT NULL,
  "collectionJobId" UUID NOT NULL,
  "uploadedById" UUID NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "caption" TEXT,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectionPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CollectionPhoto_collectionJobId_createdAt_idx" ON "CollectionPhoto"("collectionJobId", "createdAt");

ALTER TABLE "CollectionPhoto" ADD CONSTRAINT "CollectionPhoto_collectionJobId_fkey"
  FOREIGN KEY ("collectionJobId") REFERENCES "CollectionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectionPhoto" ADD CONSTRAINT "CollectionPhoto_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidence photos can never be edited or removed.
CREATE TRIGGER "CollectionPhoto_append_only"
  BEFORE UPDATE OR DELETE ON "CollectionPhoto"
  FOR EACH ROW EXECUTE FUNCTION "append_only_guard"();
