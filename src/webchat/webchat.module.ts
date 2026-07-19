import { Module } from '@nestjs/common'
import { WebchatController } from './webchat.controller'
import { WebchatService } from './webchat.service'
import { TenantsModule } from '../tenants/tenants.module'

@Module({
  imports: [TenantsModule],
  controllers: [WebchatController],
  providers: [WebchatService],
  exports: [WebchatService],
})
export class WebchatModule {}
