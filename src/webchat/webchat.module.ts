import { Module } from '@nestjs/common'
import { WebchatController } from './webchat.controller'
import { WebchatService } from './webchat.service'

@Module({
  controllers: [WebchatController],
  providers: [WebchatService],
  exports: [WebchatService],
})
export class WebchatModule {}
