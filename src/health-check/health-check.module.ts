import { Module } from '@nestjs/common'
import { HealthCheckService } from './health-check.service'
import { TelegramModule } from '../telegram/telegram.module'

@Module({
  imports: [TelegramModule],
  providers: [HealthCheckService],
})
export class HealthCheckModule {}
