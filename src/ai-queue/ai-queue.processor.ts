import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { WebchatService } from '../webchat/webchat.service'
import { InstagramService } from '../instagram/instagram.service'
import { TelegramService } from '../telegram/telegram.service'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { MessagesService } from '../messages/messages.service'
import { Logger } from '@nestjs/common'
import { AiMessageJobData } from './ai-queue.service'

@Processor('ai-message-processing')
export class AiQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AiQueueProcessor.name)

  constructor(
    private webchatService: WebchatService,
    private instagramService: InstagramService,
    private telegramService: TelegramService,
    private whatsappService: WhatsappService,
    private messagesService: MessagesService,
  ) { super() }

  async process(job: Job<AiMessageJobData>): Promise<void> {
    const { platform, tenantId, senderId, message } = job.data

    const reply = await this.webchatService.generatePlatformResponse(tenantId, platform, senderId, message)

    if (!reply) {
      this.logger.warn(`AI null/empty: plat=${platform} tenant=${tenantId} sender=${senderId} msg=${message.slice(0, 50)}`)
      throw new Error(`AI null/empty for ${platform}/${tenantId}/${senderId}`)
    }

    switch (platform) {
      case 'instagram':
        await this.sendInstagram(tenantId, senderId, reply)
        break
      case 'telegram':
        await this.sendTelegram(job.data, reply)
        break
      case 'whatsapp':
        await this.sendWhatsapp(tenantId, senderId, reply)
        break
    }
  }

  private async sendInstagram(tenantId: string, to: string, reply: string) {
    const ok = await this.instagramService.sendMessage(tenantId, to, reply)
    if (ok) {
      await this.messagesService.create({
        platform: 'instagram', from: to, content: reply, tenantId, direction: 'outgoing', status: 'sent',
      }).catch(() => {})
    }
  }

  private async sendTelegram(data: AiMessageJobData, reply: string) {
    const ok = await this.telegramService.sendTenantMessage(data.tenantId, data.chatId || data.senderId, reply)
    if (ok) {
      await this.messagesService.create({
        platform: 'telegram', from: data.senderId, fromName: data.fromName || '',
        content: reply, messageId: 'out_' + Date.now().toString(), tenantId: data.tenantId, direction: 'outgoing',
      }).catch(() => {})
    }
  }

  private async sendWhatsapp(tenantId: string, to: string, reply: string) {
    const sendResult = await this.whatsappService.sendMessage(tenantId, to, reply)
    if (sendResult?.messageId) {
      await this.messagesService.create({
        platform: 'whatsapp', from: to, content: reply, tenantId,
        direction: 'outgoing', messageId: sendResult.messageId, status: 'sent',
      }).catch(() => {})
    }
  }
}
