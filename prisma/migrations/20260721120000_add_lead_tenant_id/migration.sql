-- Add tenantId to Lead model
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Lead" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Lead" ADD CONSTRAINT IF NOT EXISTS "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "Lead_tenantId_idx" ON "Lead"("tenantId");
