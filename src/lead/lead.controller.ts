import { Controller, Get, Post, Put, Param, Body, ParseIntPipe } from '@nestjs/common'
import { LeadService } from './lead.service'
import { Public } from '../auth/public.decorator'

@Controller('leads')
export class LeadController {
  constructor(private leadService: LeadService) {}

  @Public()
  @Post()
  async create(@Body() dto: any) {
    return this.leadService.create(dto)
  }

  @Get()
  async findAll() {
    return this.leadService.findAll()
  }

  @Get('stats')
  async stats() {
    return this.leadService.getStats()
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.leadService.findOne(id)
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { status: string; notes?: string }
  ) {
    return this.leadService.updateStatus(id, dto.status, dto.notes)
  }
}
