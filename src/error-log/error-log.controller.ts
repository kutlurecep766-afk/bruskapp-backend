import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common'
import { ErrorLogService } from './error-log.service'

@Controller('error-logs')
export class ErrorLogController {
  constructor(private errorLog: ErrorLogService) {}

  @Get()
  async getErrors(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: string,
    @Query('platform') platform?: string,
    @Query('acknowledged') acknowledged?: string,
  ) {
    const tenantId = req.user?.tenantId
    return this.errorLog.getErrors({
      tenantId,
      type,
      platform,
      limit: limit ? parseInt(limit) : 50,
      cursor,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
    })
  }

  @Get('stats')
  async getStats(@Req() req: any) {
    const tenantId = req.user?.tenantId
    return this.errorLog.getStats(tenantId)
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id') id: string) {
    return this.errorLog.acknowledgeError(id)
  }

  @Post('acknowledge-all')
  async acknowledgeAll(@Req() req: any) {
    const tenantId = req.user?.tenantId
    return this.errorLog.acknowledgeAll(tenantId)
  }
}
