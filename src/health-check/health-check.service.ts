import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { Redis } from 'ioredis'

@Injectable()
export class HealthCheckService implements OnModuleInit {
  private readonly logger = new Logger(HealthCheckService.name)
  private interval: ReturnType<typeof setInterval> | null = null
  private redisDown = false

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    this.interval = setInterval(() => this.checkAll(), 300000)
    // Baslangicta kisa sure sonra ilk kontrol (acilis kontrolu)
    setTimeout(() => this.checkAll(), 15000)
    this.logger.log('Saglik kontrolu baslatildi (5 dk)')
  }

  private async checkAll() {
    try {
      await this.checkRedis()

      const telegramConfigs = await this.prisma.telegramConfig.findMany({ where: { active: true } })
      for (const tc of telegramConfigs) {
        try {
          const botInfo = await this.telegramService.getBotInfo(tc.botToken)
          if (!botInfo) {
            this.logger.warn('Telegram bot yanit vermiyor: ' + tc.tenantId)
            await this.prisma.errorLog.create({
              data: {
                type: 'system_error',
                platform: 'telegram',
                tenantId: tc.tenantId,
                title: 'Telegram bot yanit vermiyor',
                message: 'Bot token dogrulamasi basarisiz. Tenant: ' + tc.tenantId,
              },
            })
            await this.telegramService.sendAdminAlert(
              'Telegram Bot Hatasi',
              'Tenant: ' + tc.tenantId + '\nBot yanit vermiyor, yeniden baglanti gerekiyor.'
            )
          }
        } catch {}
      }

      const zernioConnections = await this.prisma.zernioConnection.findMany({
        where: { profileId: { not: null } },
      })
      if (zernioConnections.length > 0) {
        this.logger.log('Zernio saglik: ' + zernioConnections.length + ' profil izleniyor')
      }

      const recentErrors = await this.prisma.errorLog.count({
        where: { createdAt: { gte: new Date(Date.now() - 86400000) }, acknowledged: false },
      })
      if (recentErrors > 10) {
        await this.telegramService.sendAdminAlert(
          'Cok Sayida Hata',
          'Son 24 saatte ' + recentErrors + ' acknowledged edilmemis hata var. Admin panelden kontrol edin.'
        )
      }
    } catch (e: any) {
      this.logger.error('Saglik kontrolu hatasi: ' + (e?.message || ''))
    }
  }

  // Redis + AI kuyrugu (BullMQ) izleme. Kuyruk coktugunde AI cevaplari (Telegram/WhatsApp/Instagram)
  // sessizce durduğu için bu kritik kontrol.
  private async checkRedis() {
    const host = process.env.REDIS_HOST || 'bruskapp-redis'
    const port = parseInt(process.env.REDIS_PORT || '6379', 10)
    const client = new Redis({
      host,
      port,
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    })
    try {
      await client.connect()
      const pong = await client.ping()
      if (pong !== 'PONG') throw new Error('PING yanit vermedi')
      const waiting = await client.llen('bull:ai-message-processing:wait').catch(() => 0)
      const active = await client.llen('bull:ai-message-processing:active').catch(() => 0)

      if (this.redisDown) {
        this.redisDown = false
        this.logger.log('Redis/Kuyruk tekrar calisiyor')
        await this.telegramService.sendAdminAlert(
          'Kuyruk Duzeldi',
          'Redis baglantisi geri geldi. AI cevaplari tekrar calisiyor.'
        ).catch(() => {})
      }

      if (waiting > 20) {
        this.logger.warn('AI kuyrugu birikmesi: bekleyen=' + waiting)
        await this.telegramService.sendAdminAlert(
          'Kuyruk Birikmesi',
          'AI kuyrugunda ' + waiting + ' bekleyen is var. Redis/worker kontrol edin.'
        ).catch(() => {})
      } else {
        this.logger.log('Redis OK (bekleyen=' + waiting + ', aktif=' + active + ')')
      }
    } catch (e: any) {
      if (!this.redisDown) {
        this.redisDown = true
        this.logger.error('Redis/Kuyruk KAPALI: ' + (e?.message || ''))
        await this.prisma.errorLog.create({
          data: {
            type: 'system_error',
            platform: 'system',
            tenantId: 'system',
            title: 'Redis/Kuyruk coktu',
            message: 'Redis (' + host + ':' + port + ') erisilemiyor: ' + (e?.message || ''),
          },
        }).catch(() => {})
        await this.telegramService.sendAdminAlert(
          'Redis/Kuyruk COKTU',
          'Redis ' + host + ':' + port + ' erisilemiyor. AI (Telegram/WhatsApp/Instagram) cevaplari durdu!'
        ).catch(() => {})
      }
    } finally {
      try { client.disconnect() } catch {}
    }
  }
}
