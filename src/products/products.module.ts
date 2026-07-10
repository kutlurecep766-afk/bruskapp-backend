import { Module } from '@nestjs/common'
import { ProductsController } from './products.controller'
import { ProductsService } from './products.service'
import { MarketplaceModule } from '../marketplace/marketplace.module'
import { StockMovementsModule } from '../stock-movements/stock-movements.module'

@Module({
  imports: [MarketplaceModule, StockMovementsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
