import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { InstagramController } from './instagram.controller'
import { InstagramService } from './instagram.service'
import { MessagesModule } from '../messages/messages.module'

@Module({
  imports: [HttpModule, MessagesModule],
  controllers: [InstagramController],
  providers: [InstagramService],
})
export class InstagramModule {}
