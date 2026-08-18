-- Takip kodu işletmeye özel oluyor: (tenantId, trackingCode) birlikte benzersiz
DROP INDEX IF EXISTS "Order_trackingCode_key";
CREATE UNIQUE INDEX "Order_tenantId_trackingCode_key" ON "Order"("tenantId", "trackingCode");
