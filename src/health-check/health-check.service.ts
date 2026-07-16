import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { TelegramService } from '../telegram/telegram.service'

@Injectable()
export class HealthCheckService implements OnModuleInit {
  private readonly logger = new Logger(HealthCheckService.name)
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    this.interval = setInterval(() => this.checkAll(), 300000)
    this.logger.log('Saglik kontrolu baslatildi (5 dk)')
  }

  private async checkAll() {
    try {
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
}
