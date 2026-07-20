-- CreateTable
CREATE TABLE "Appointment" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'webchat',
    "customerName" TEXT NOT NULL,
    "customerContact" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "service" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Reservation" (
    "id" SERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'webchat',
    "customerName" TEXT NOT NULL,
    "customerContact" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "guests" INTEGER NOT NULL DEFAULT 2,
    "tableNumber" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Appointment_tenantId_createdAt_idx" ON "Appointment"("tenantId", "createdAt");
CREATE INDEX "Appointment_tenantId_status_idx" ON "Appointment"("tenantId", "status");
CREATE INDEX "Reservation_tenantId_createdAt_idx" ON "Reservation"("tenantId", "createdAt");
CREATE INDEX "Reservation_tenantId_status_idx" ON "Reservation"("tenantId", "status");
