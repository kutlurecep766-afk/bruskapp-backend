-- Siparişlere cihaz kimliği ve IP eklendi, sahte sipariş engeli için BlockedDevice tablosu
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;

CREATE TABLE IF NOT EXISTS "BlockedDevice" (
    "id" SERIAL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BlockedDevice_tenantId_deviceId_idx" ON "BlockedDevice"("tenantId", "deviceId");
CREATE INDEX IF NOT EXISTS "BlockedDevice_tenantId_ipAddress_idx" ON "BlockedDevice"("tenantId", "ipAddress");
