import { Controller, Get, Post, Put, Delete, Param, Res, Body, Req } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { NotificationsService } from './notifications.service'
import { Response } from 'express'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('preferences')
  async getPreferences(@Req() req: any) {
    const tenantId = req.user?.tenantId || ''
    if (!tenantId) return {}
    return this.notificationsService.getPreferences(tenantId)
  }

  @Post('preferences')
  async setPreferences(@Req() req: any, @Body() body: { newOrder?: boolean; lowStock?: boolean; newMessage?: boolean }) {
    const tenantId = req.user?.tenantId || ''
    if (!tenantId) return { success: false, message: 'Tenant bulunamadi' }
    await this.notificationsService.setPreferences(tenantId, body)
    return { success: true }
  }

  @Public()
  @Get('announcements')
  async getAnnouncements() {
    return this.notificationsService.getActiveAnnouncements()
  }

  @Public()
  @Get('announcements/all')
  async getAllAnnouncements() {
    return this.notificationsService.getAnnouncements()
  }

  @Public()
  @Post('announcements')
  async createAnnouncement(@Body() body: { title: string; message: string }) {
    if (!body.title || !body.message) return { success: false, message: 'Baslik ve mesaj gerekli' }
    const a = await this.notificationsService.createAnnouncement(body.title, body.message, 'admin')
    return { success: true, announcement: a }
  }

  @Public()
  @Post('announcements/:id/approve')
  async approveAnnouncement(@Param('id') id: string) {
    const a = await this.notificationsService.approveAnnouncement(id)
    return { success: true, announcement: a }
  }

  @Public()
  @Put('announcements/:id')
  async updateAnnouncement(@Param('id') id: string, @Body() body: { title?: string; message?: string; isActive?: boolean; status?: string }) {
    const a = await this.notificationsService.updateAnnouncement(id, body)
    return { success: true, announcement: a }
  }

  @Public()
  @Delete('announcements/:id')
  async deleteAnnouncement(@Param('id') id: string) {
    await this.notificationsService.deleteAnnouncement(id)
    return { success: true }
  }

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
  async getTelegramConfig(@Req() req: any) {
    return this.notificationsService.getTelegramConfig(req.user?.tenantId || '')
  }

  @Post('telegram-config')
  async setTelegramConfig(@Req() req: any, @Body() body: { botToken: string; chatId: string }) {
    return this.notificationsService.setTelegramConfig(body.botToken, body.chatId, req.user?.tenantId || '')
  }

  @Post('telegram-toggle')
  async toggleTelegram(@Req() req: any, @Body() body: { enabled: boolean }) {
    return this.notificationsService.toggleTelegram(body.enabled, req.user?.tenantId || '')
  }
}
