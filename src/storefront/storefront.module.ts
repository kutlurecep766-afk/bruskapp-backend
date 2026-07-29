import { Module } from '@nestjs/common'
import { StorefrontController } from './storefront.controller'
import { StorefrontService } from './storefront.service'
import { PrismaModule } from '../prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [StorefrontController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
