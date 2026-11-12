-- Numbers for boxes and invoices.
CREATE SEQUENCE box_number_seq START 1;
CREATE SEQUENCE invoice_number_seq START 1;

CREATE TYPE "BoxForm" AS ENUM ('HEAD_ON', 'HEADLESS');
CREATE TYPE "BoxStatus" AS ENUM ('PACKED', 'VOID');
CREATE TYPE "PaymentOption" AS ENUM ('PAY_NOW', 'PAY_LATER');
CREATE TYPE "PaymentStatus" AS ENUM ('PAY_LATER', 'PAID');

ALTER TABLE "Shipment" ADD COLUMN "packingApprovedAt" TIMESTAMP(3), ADD COLUMN "packingNote" TEXT;

CREATE TABLE "BoxRequirement" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "form" "BoxForm" NOT NULL,
  "sizeGrade" TEXT NOT NULL,
  "boxWeightKg" DECIMAL(8,3) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoxRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BoxRequirement_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "BoxRequirement_weight_positive" CHECK ("boxWeightKg" > 0)
);
CREATE UNIQUE INDEX "BoxRequirement_requestId_form_sizeGrade_boxWeightKg_key" ON "BoxRequirement"("requestId", "form", "sizeGrade", "boxWeightKg");
CREATE INDEX "BoxRequirement_requestId_idx" ON "BoxRequirement"("requestId");

CREATE TABLE "PackedBox" (
  "id" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "form" "BoxForm" NOT NULL,
  "sizeGrade" TEXT NOT NULL,
  "netWeightKg" DECIMAL(8,3) NOT NULL,
  "status" "BoxStatus" NOT NULL DEFAULT 'PACKED',
  "boxNumber" TEXT,
  "numberedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "packedById" UUID NOT NULL,
  "packedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackedBox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackedBox_weight_positive" CHECK ("netWeightKg" > 0)
);
CREATE UNIQUE INDEX "PackedBox_boxNumber_key" ON "PackedBox"("boxNumber");
CREATE INDEX "PackedBox_shipmentId_status_idx" ON "PackedBox"("shipmentId", "status");
CREATE INDEX "PackedBox_requirementId_idx" ON "PackedBox"("requirementId");

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "option" "PaymentOption" NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "decidedById" UUID NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invoiceNumber" TEXT,
  "invoicedAt" TIMESTAMP(3),
  "quantityKg" DECIMAL(12,3),
  "quantityBasis" TEXT,
  "ratePerKg" DECIMAL(12,2),
  "amountInr" DECIMAL(14,2),
  "method" TEXT,
  "reference" TEXT,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_shipmentId_key" ON "Payment"("shipmentId");
CREATE UNIQUE INDEX "Payment_invoiceNumber_key" ON "Payment"("invoiceNumber");
CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

ALTER TABLE "BoxRequirement" ADD CONSTRAINT "BoxRequirement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BoxRequirement" ADD CONSTRAINT "BoxRequirement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedBox" ADD CONSTRAINT "PackedBox_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedBox" ADD CONSTRAINT "PackedBox_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "BoxRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackedBox" ADD CONSTRAINT "PackedBox_packedById_fkey" FOREIGN KEY ("packedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
