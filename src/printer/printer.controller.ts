import { Controller, Get, Post, Body, Req, Sse, MessageEvent, Query } from '@nestjs/common'
import { Observable, map } from 'rxjs'
import { Public } from '../auth/public.decorator'
import { PrinterService } from './printer.service'

@Controller('printer')
export class PrinterController {
  constructor(private printerService: PrinterService) {}

  @Public()
  @Sse('events')
  events(@Query('token') token: string): Observable<MessageEvent> {
    return this.printerService.printJobs.pipe(
      map(job => ({ data: { ...job, token } } as MessageEvent))
    )
  }

  @Get('config')
  async getConfig(@Req() req: any) {
    return this.printerService.getConfig(req.user?.tenantId || '')
  }

  @Post('config')
  async saveConfig(@Req() req: any, @Body() body: any) {
    return this.printerService.saveConfig(req.user?.tenantId || '', body)
  }
}
