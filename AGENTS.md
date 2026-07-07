## Context
NestJS + PostgreSQL backend for BruskApp (marketplace order management). 102 `Order` rows, 5 active platforms: **Trendyol, Hepsiburada, Yemeksepeti, n11, TrendyolGo**. Deployed on VPS via blue-green `deploy-backend.ps1`.

## Key Facts
- **Migrating from SaaS marketplace integrations** — Amazon, ÇiçekSepeti, Pazarama, PTTAVM already removed
- **BullMQ queue mode in production** — Redis at `bruskapp-redis:6379`, Bull Board at `/api/admin/queues`
- **Prisma migration `add_marketplace_order_fields` already run** — `MarketplaceOrder` enhanced with `customerPhone`, `customerEmail`, `deliveryAddress`, `discountPrice`, `shippingPrice`, `paymentType`, `isPickedUp`, `rawPayload`, `platformCreatedAt`; `MarketplaceOrderItem` model created
- **Pure-function adapters** — 5 adapters (`trendyol.adapter.ts`, `hepsiburada.adapter.ts`, `yemeksepeti.adapter.ts`, `n11.adapter.ts`, `trendyolgo.adapter.ts`) + `toCommonOrder()` registry + `saveCommonOrder()` utility

## Completed Work

### Common Order Schema & Adapters (✓ DONE)
- **Prisma models** — `MarketplaceOrder` enhanced (all new fields), `MarketplaceOrderItem` created with `options JSON`, `@@index([orderId])`
- **5 platform adapters** — Pure functions mapping raw API → `OrderInput` interface
- **`saveCommonOrder()` utility** — Handles upsert + `MarketplaceOrderItem` deleteMany+createMany
- **TrendyolService.getOrders()** — Uses `toCommonOrder('trendyol', ...)` + `saveCommonOrder()`
- **HepsiburadaService.getOrders()** — Uses `toCommonOrder('hepsiburada', ...)` + `saveCommonOrder()`
- **YemeksepetiService.getOrders()** — Uses `toCommonOrder('yemeksepeti', ...)` + `saveCommonOrder()`
- **N11Provider.getOrders()** — Uses `toCommonOrder('n11', ...)` + `saveCommonOrder()`
- **TrendyolGoProvider.getOrders()** — Uses `toCommonOrder('trendyolgo', ...)` + `saveCommonOrder()`
- **Old `customerContact`/`products` fields** — Completely purged from all services, providers, and adapters
- **TypeScript build** — `npx tsc --noEmit` and `npm run build` pass clean

### API Fixes (PREVIOUSLY DONE)
- **n11 SOAP** — Request suffix on body elements, namespace prefix regex, `version` in stock update, empty SOAPAction
- **Hepsiburada** — `/claims`→`/orders`, User-Agent `"{merchantId} - BruskApp/1.0"`, barcode+title mapping
- **Yemeksepeti** — Token cache (7200s), `page_size`, 1-indexed pages, `start_time`/`end_time`, field mapping, PUT fulfillment
- **Trendyol** — Webhook registration `authenticationType: 'API_KEY'`, stock `salePrice`/`listPrice`, order `startDate` (7 days)
- **Rate limit retry** — `retryWithBackoff` + `httpRetry` with exponential backoff + `Retry-After` respect
- **Webhook guard** — `webhook-guard.ts` HMAC verification
- **BullMQ queue** — Redis + `@nestjs/bullmq`, `hbs-poll-all` repeatable job (5 min), Bull Board at `/api/admin/queues`
- **Job dedup/backoff** — `jobId` per tenant+platform, attempts:5, exponential 3s/5s

## Next Steps
1. **Prisma migration** — `npx prisma migrate dev --name add_marketplace_order_fields` (already run, but verify if it's applied on VPS)
2. **Build + deploy** — `npm run build`, `node deploy-backend.ps1`
3. **Wire queue producer** — Call `addSyncOrders`/`addSyncProducts` from controllers

## Relevant Files
- `prisma/schema.prisma` — `MarketplaceOrder` + `MarketplaceOrderItem` models
- `src/marketplace/adapters/marketplace-order-adapter.interface.ts` — `OrderInput`, `OrderItemInput` types
- `src/marketplace/adapters/index.ts` — `toCommonOrder()`, `saveCommonOrder()` exports
- `src/marketplace/adapters/save-common-order.ts` — Upsert + item save utility
- `src/marketplace/adapters/trendyol.adapter.ts`
- `src/marketplace/adapters/hepsiburada.adapter.ts`
- `src/marketplace/adapters/yemeksepeti.adapter.ts`
- `src/marketplace/adapters/n11.adapter.ts`
- `src/marketplace/adapters/trendyolgo.adapter.ts`
- `src/trendyol/trendyol.service.ts`
- `src/hepsiburada/hepsiburada.service.ts`
- `src/yemeksepeti/yemeksepeti.service.ts`
- `src/marketplace/providers/n11.provider.ts`
- `src/marketplace/providers/trendyolgo.provider.ts`

## Regression Test Results (KNOWN FAILING)
- `orders` (400) — pre-existing, not from our changes
- `auth` (404) — pre-existing, not from our changes
