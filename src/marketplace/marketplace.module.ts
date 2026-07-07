import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { MarketplaceController } from './marketplace.controller'
import { MarketplaceService } from './marketplace.service'
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

@Module({
  imports: [HttpModule, PrismaModule, OrdersModule, TrendyolModule, HepsiburadaModule, YemeksepetiModule],
  controllers: [MarketplaceController],
  providers: [
    MarketplaceService,
    N11Provider,
    TrendyolProvider,
    HepsiburadaProvider,
    YemeksepetiProvider,
    TrendyolGoProvider,
  ],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
