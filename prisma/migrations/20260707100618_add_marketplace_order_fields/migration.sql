-- MarketplaceOrder: add new columns
ALTER TABLE "MarketplaceOrder" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "customerEmail" TEXT;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "deliveryAddress" JSONB;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "discountPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "shippingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "paymentType" TEXT;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "isPickedUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "rawPayload" JSONB;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "platformCreatedAt" TIMESTAMP(3);

-- CreateTable: MarketplaceOrderItem
CREATE TABLE "MarketplaceOrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "platformItemId" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: orderId lookup
CREATE INDEX "MarketplaceOrderItem_orderId_idx" ON "MarketplaceOrderItem"("orderId");

-- AddForeignKey: cascade delete
ALTER TABLE "MarketplaceOrderItem" ADD CONSTRAINT "MarketplaceOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
