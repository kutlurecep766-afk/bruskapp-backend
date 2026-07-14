import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PushController } from './push.controller'
import { PushService } from './push.service'

@Module({
  imports: [HttpModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
