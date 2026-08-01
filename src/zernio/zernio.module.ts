import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ZernioService } from './zernio.service'
import { ZernioController } from './zernio.controller'
import { MessagesModule } from '../messages/messages.module'
import { AiQueueModule } from '../ai-queue/ai-queue.module'

@Module({
  imports: [HttpModule, MessagesModule, AiQueueModule],
  controllers: [ZernioController],
  providers: [ZernioService],
  exports: [ZernioService],
})
export class ZernioModule {}
