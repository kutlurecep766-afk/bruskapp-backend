import { Controller, Get, Post, Param, Res, Body } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { NotificationsService } from './notifications.service'
import { Response } from 'express'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Public()
  @Get()
  async getNotifications() {
    return this.notificationsService.getNotifications()
  }

  @Public()
  @Get('events')
  async events(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const cleanup = this.notificationsService.addClient((data) => {
      res.write('data: ' + JSON.stringify(data) + '\n\n')
    })

    res.on('close', () => {
      cleanup()
      res.end()
    })
  }

  @Public()
  @Get('stream/:businessId')
  async streamEvents(@Param('businessId') businessId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const cleanup = this.notificationsService.addBusinessClient(businessId, (data) => {
      res.write('data: ' + JSON.stringify(data) + '\n\n')
    })

    res.on('close', () => {
      cleanup()
      res.end()
    })
  }

  @Public()
  @Post('test/:platform')
  async sendTest(@Param('platform') platform: string) {
    return this.notificationsService.sendTest(platform)
  }

  @Public()
  @Post('read/:id')
  async markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(parseInt(id))
  }

  @Public()
  @Post('read-all')
  async markAllRead() {
    return this.notificationsService.markAllRead()
  }

  @Public()
  @Post('subscribe')
  async subscribe(@Body() body: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return this.notificationsService.subscribe(body.endpoint, body.keys)
  }

  @Public()
  @Get('telegram-config')
  async getTelegramConfig() {
    return this.notificationsService.getTelegramConfig()
  }

  @Public()
  @Post('telegram-config')
  async setTelegramConfig(@Body() body: { botToken: string; chatId: string }) {
    return this.notificationsService.setTelegramConfig(body.botToken, body.chatId)
  }

  @Public()
  @Post('telegram-toggle')
  async toggleTelegram(@Body() body: { enabled: boolean }) {
    return this.notificationsService.toggleTelegram(body.enabled)
  }
}
