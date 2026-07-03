import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { PrismaModule } from '../prisma.module'
import { KargomucuzController } from './kargomucuz.controller'
import { KargomucuzService } from './kargomucuz.service'

@Module({
  imports: [HttpModule, PrismaModule],
  controllers: [KargomucuzController],
  providers: [KargomucuzService],
  exports: [KargomucuzService],
})
export class KargomucuzModule {}
