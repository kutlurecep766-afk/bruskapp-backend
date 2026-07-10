import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { BullModule } from '@nestjs/bullmq'
import { BullBoardModule } from '@bull-board/nestjs'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { MarketplaceController } from './marketplace.controller'
import { MarketplaceService } from './marketplace.service'
import { MarketplaceQueueService } from './marketplace-queue.service'
import { MarketplaceQueueWorker } from './marketplace-queue.worker'
import { N11Provider } from './providers/n11.provider'
import { TrendyolProvider } from './providers/trendyol.provider'
import { HepsiburadaProvider } from './providers/hepsiburada.provider'
import { YemeksepetiProvider } from './providers/yemeksepeti.provider'
import { TrendyolGoProvider } from './providers/trendyolgo.provider'
import { TrendyolModule } from '../trendyol/trendyol.module'
import { HepsiburadaModule } from '../hepsiburada/hepsiburada.module'
import { YemeksepetiModule } from '../yemeksepeti/yemeksepeti.module'
import { PrismaModule } from '../prisma.module'
import { OrdersModule } from '../orders/orders.module'
import { StockMovementsModule } from '../stock-movements/stock-movements.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    HttpModule, PrismaModule, OrdersModule, TrendyolModule, HepsiburadaModule, YemeksepetiModule, StockMovementsModule, NotificationsModule,
    BullModule.registerQueue({
      name: 'marketplace-sync',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
    BullBoardModule.forFeature({
      name: 'marketplace-sync',
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [MarketplaceController],
  providers: [
    MarketplaceService,
    MarketplaceQueueService,
    MarketplaceQueueWorker,
    N11Provider,
    TrendyolProvider,
    HepsiburadaProvider,
    YemeksepetiProvider,
    TrendyolGoProvider,
  ],
  exports: [MarketplaceService, MarketplaceQueueService],
})
export class MarketplaceModule {}