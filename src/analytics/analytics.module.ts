import { Module } from '@nestjs/common'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'
import { TelegramModule } from '../telegram/telegram.module'

@Module({
  imports: [TelegramModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
