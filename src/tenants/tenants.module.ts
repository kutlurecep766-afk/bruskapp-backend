import { Module } from '@nestjs/common'
import { TenantsController } from './tenants.controller'
import { TenantCreditsController } from './tenant-credits.controller'
import { TenantsService } from './tenants.service'

@Module({
  controllers: [TenantsController, TenantCreditsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
