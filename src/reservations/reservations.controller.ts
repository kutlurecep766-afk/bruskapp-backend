import { Controller, Get, Post, Param, Body, Query, ParseIntPipe } from '@nestjs/common'
import { ReservationsService } from './reservations.service'
import { Public } from '../auth/public.decorator'

@Controller('reservations')
export class ReservationsController {
  constructor(private service: ReservationsService) {}

  @Public()
  @Post()
  async create(@Body() body: { tenantId: string; platform?: string; customerName: string; customerContact?: string; date: string; time?: string; guests?: number; tableNumber?: number; notes?: string }) {
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
