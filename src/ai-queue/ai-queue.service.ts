import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'

export interface AiMessageJobData {
  platform: 'instagram' | 'telegram' | 'whatsapp'
  tenantId: string
  senderId: string
  message: string
  chatId?: string
  fromName?: string
}

@Injectable()
export class AiQueueService {
  constructor(@InjectQueue('ai-message-processing') private queue: Queue) {}

  async enqueue(data: AiMessageJobData) {
    await this.queue.add('process-ai-message', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    })
  }
}
