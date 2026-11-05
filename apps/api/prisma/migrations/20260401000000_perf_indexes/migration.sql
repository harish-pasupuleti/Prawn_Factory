-- Speeds up the manager's status-filtered inspection and collection lists.
CREATE INDEX "FieldInspection_status_createdAt_idx" ON "FieldInspection"("status", "createdAt");
CREATE INDEX "CollectionJob_status_createdAt_idx" ON "CollectionJob"("status", "createdAt");
