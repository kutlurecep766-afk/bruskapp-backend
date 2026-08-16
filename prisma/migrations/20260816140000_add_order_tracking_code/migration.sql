ALTER TABLE "Order" ADD COLUMN "trackingCode" TEXT;

CREATE UNIQUE INDEX "Order_trackingCode_key" ON "Order"("trackingCode");