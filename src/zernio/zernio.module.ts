import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ZernioService } from './zernio.service'
import { ZernioController } from './zernio.controller'

@Module({
  imports: [HttpModule],
  controllers: [ZernioController],
  providers: [ZernioService],
  exports: [ZernioService],
})
export class ZernioModule {}
