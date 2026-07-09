import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { InstagramController } from './instagram.controller'
import { InstagramService } from './instagram.service'
import { MessagesModule } from '../messages/messages.module'
import { WebchatModule } from '../webchat/webchat.module'

@Module({
  imports: [HttpModule, MessagesModule, WebchatModule],
  controllers: [InstagramController],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
