import { Module } from '@nestjs/common'
import { ErrorLogController } from './error-log.controller'
import { ErrorLogService } from './error-log.service'
import { TelegramModule } from '../telegram/telegram.module'

@Module({
  imports: [TelegramModule],
  controllers: [ErrorLogController],
  providers: [ErrorLogService],
  exports: [ErrorLogService],
})
export class ErrorLogModule {}
