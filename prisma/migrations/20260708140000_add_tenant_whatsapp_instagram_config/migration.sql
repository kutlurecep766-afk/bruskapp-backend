-- CreateTable
CREATE TABLE "TenantWhatsAppConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantWhatsAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantInstagramConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "igBusinessAccountId" TEXT NOT NULL,
    "webhookToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantInstagramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantWhatsAppConfig_tenantId_key" ON "TenantWhatsAppConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantInstagramConfig_tenantId_key" ON "TenantInstagramConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantWhatsAppConfig" ADD CONSTRAINT "TenantWhatsAppConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantInstagramConfig" ADD CONSTRAINT "TenantInstagramConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
