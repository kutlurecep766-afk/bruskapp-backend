CREATE TABLE "ConversationAiOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationAiOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConversationAiOverride_tenantId_platform_from_key" UNIQUE ("tenantId", "platform", "from")
);

CREATE INDEX "ConversationAiOverride_tenantId_idx" ON "ConversationAiOverride"("tenantId");
