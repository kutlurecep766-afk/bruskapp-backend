import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { YemeksepetiController } from './yemeksepeti.controller'
import { YemeksepetiService } from './yemeksepeti.service'
import { PrismaModule } from '../prisma.module'

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [YemeksepetiService],
  exports: [YemeksepetiService],
})
export class YemeksepetiModule {}
