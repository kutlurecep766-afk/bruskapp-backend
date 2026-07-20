import { Controller, Get, Post, Param, Body, Query, ParseIntPipe } from '@nestjs/common'
import { AppointmentsService } from './appointments.service'
import { Public } from '../auth/public.decorator'

@Controller('appointments')
export class AppointmentsController {
  constructor(private service: AppointmentsService) {}

  @Public()
  @Post()
  async create(@Body() body: { tenantId: string; platform?: string; customerName: string; customerContact?: string; date: string; time?: string; service?: string; notes?: string }) {
    return this.service.create(body)
  }

  @Get()
  async findAll(@Query('tenantId') tenantId: string) {
    return this.service.findAll(tenantId)
  }

  @Post(':id/status')
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: string }) {
    return this.service.updateStatus(id, body.status)
  }
}
