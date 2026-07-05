import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { MarketplaceController } from './marketplace.controller'
import { MarketplaceService } from './marketplace.service'
import { TrendyolGoProvider } from './providers/trendyolgo.provider'
import { AmazonProvider } from './providers/amazon.provider'
import { N11Provider } from './providers/n11.provider'
import { CicekSepetiProvider } from './providers/ciceksepeti.provider'
import { PazaramaProvider } from './providers/pazarama.provider'
import { PttAvmProvider } from './providers/pttavm.provider'
import { PrismaModule } from '../prisma.module'
import { OrdersModule } from '../orders/orders.module'

@Module({
  imports: [HttpModule, PrismaModule, OrdersModule],
  controllers: [MarketplaceController],
  providers: [
    MarketplaceService,
    TrendyolGoProvider,
    AmazonProvider,
    N11Provider,
    CicekSepetiProvider,
    PazaramaProvider,
    PttAvmProvider,
  ],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
