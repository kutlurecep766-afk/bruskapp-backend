import { Controller, Post, Get, Body, Req, ForbiddenException } from '@nestjs/common'
import { PushService } from './push.service'

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-key')
  getVapidKey() {
    return { publicKey: this.pushService.getPublicKey() }
  }

  @Post('subscribe')
  async subscribe(@Req() req: any, @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    const user = req.user as any
    if (!user || !body.endpoint) throw new ForbiddenException('Yetkiniz yok')
    const tenantId = user.tenantId || ''
    this.pushService.subscribe(tenantId, body)
    return { status: 'subscribed' }
  }
}
