-- Add webchatConfig and adminChatId to Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "webchatConfig" JSONB DEFAULT '{}';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "adminChatId" TEXT;

-- Create TelegramConfig table
CREATE TABLE IF NOT EXISTS "TelegramConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "botInfo" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TelegramConfig_tenantId_key" UNIQUE ("tenantId")
);

ALTER TABLE "TelegramConfig" ADD CONSTRAINT "TelegramConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create ErrorLog table
CREATE TABLE IF NOT EXISTS "ErrorLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "platform" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ErrorLog_tenantId_createdAt_idx" ON "ErrorLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "ErrorLog_type_createdAt_idx" ON "ErrorLog"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "ErrorLog_acknowledged_idx" ON "ErrorLog"("acknowledged");
