import { Controller, Get, Post, Body, Query, Res, Req, HttpException, HttpStatus } from '@nestjs/common'
import { MessagesService } from './messages.service'
import { PrismaService } from '../prisma.service'
import { Public } from '../auth/public.decorator'
import { Throttle } from '@nestjs/throttler'
import { Response, Request } from 'express'

const SSE_CONNECTIONS = new Map<string, number>()

@Controller('messages')
export class MessagesController {
  constructor(
    private messagesService: MessagesService,
    private prisma: PrismaService,
  ) {}

  private cleanupSSE(ip: string) {
    const c = SSE_CONNECTIONS.get(ip) || 1
    if (c <= 1) SSE_CONNECTIONS.delete(ip)
    else SSE_CONNECTIONS.set(ip, c - 1)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('events')
  async stream(@Res() res: Response, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const count = SSE_CONNECTIONS.get(ip) || 0
    if (count >= 3) {
      throw new HttpException('Cok fazla aktif baglanti', HttpStatus.TOO_MANY_REQUESTS)
    }
    SSE_CONNECTIONS.set(ip, count + 1)

    let cleanedUp = false
    const doCleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      this.cleanupSSE(ip)
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    res.write(':ok\n\n')

    const keepAlive = setInterval(() => {
      try { res.write(':keepalive\n\n') } catch {
        clearInterval(keepAlive)
        doCleanup()
      }
    }, 15000)

    const sub = this.messagesService.newMessage$.subscribe({
      next: (msg: any) => {
        try { res.write('data: ' + JSON.stringify(msg) + '\n\n') } catch {}
      },
      error: () => {
        clearInterval(keepAlive)
        doCleanup()
        try { res.end() } catch {}
      },
      complete: () => {
        clearInterval(keepAlive)
        doCleanup()
        try { res.end() } catch {}
      },
    })

    req.on('close', () => {
      clearInterval(keepAlive)
      sub.unsubscribe()
      doCleanup()
      try { res.destroy() } catch {}
    })

    req.on('error', () => {
      clearInterval(keepAlive)
      sub.unsubscribe()
      doCleanup()
      try { res.destroy() } catch {}
    })
  }

  @Get('conversations')
  async getConversations(@Req() req: Request) {
    const user = req.user as any
    if (!user) throw new HttpException('Yetkilendirme gerekli', HttpStatus.UNAUTHORIZED)
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) throw new HttpException('Isletme bulunamadi', HttpStatus.NOT_FOUND)
    return this.messagesService.findConversations(tenant.id)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post()
  async create(
    @Body('slug') slug: string,
    @Body('from') from: string,
    @Body('content') content: string,
    @Body('phone') phone?: string,
  ) {
    if (!slug || !from || !content) return { error: 'slug, from ve content gerekli' }
    if (from.length > 100 || content.length > 2000) return { error: 'Girdi cok uzun' }
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } })
    if (!tenant) return { error: 'Isletme bulunamadi' }
    const msg = await this.messagesService.create({
      platform: 'web_site',
      from: from + (phone ? ' (' + phone + ')' : ''),
      content,
      tenantId: tenant.id,
    })
    return { success: true, messageId: msg.id }
  }

  @Post('read')
  async markRead(@Req() req: Request, @Query('platform') platform: string, @Query('from') from: string) {
    const user = req.user as any
    if (!user) throw new HttpException('Yetkilendirme gerekli', HttpStatus.UNAUTHORIZED)
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) throw new HttpException('Isletme bulunamadi', HttpStatus.NOT_FOUND)
    await this.messagesService.markConversationRead(tenant.id, platform, from)
    return { success: true }
  }

  @Post('send')
  async sendMessage(@Req() req: Request, @Body('content') content: string, @Body('platform') platform: string, @Body('to') to: string) {
    const user = req.user as any
    if (!user) throw new HttpException('Yetkilendirme gerekli', HttpStatus.UNAUTHORIZED)
    if (!content || !platform || !to) throw new HttpException('content, platform ve to gerekli', HttpStatus.BAD_REQUEST)
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true, name: true },
    })
    if (!tenant) throw new HttpException('Isletme bulunamadi', HttpStatus.NOT_FOUND)
    const msg = await this.messagesService.create({
      platform,
      from: to,
      content,
      direction: 'outgoing',
      tenantId: tenant.id,
    })
    return { success: true, message: msg }
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('platform') platform?: string,
    @Query('from') from?: string,
  ) {
    const user = req.user as any
    if (!user) throw new HttpException('Yetkilendirme gerekli', HttpStatus.UNAUTHORIZED)
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) throw new HttpException('Isletme bulunamadi', HttpStatus.NOT_FOUND)
    return this.messagesService.findAll(tenant.id, {
      limit: limit ? parseInt(limit, 10) : 50,
      cursor,
      platform,
      from,
    })
  }
}
