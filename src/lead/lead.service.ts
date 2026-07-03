import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class LeadService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    sessionId: string
    name: string
    phone: string
    email?: string
    needs: string
    conversation: any[]
    source?: string
  }) {
    return this.prisma.lead.create({
      data: {
        sessionId: data.sessionId,
        name: data.name || '',
        phone: data.phone || '',
        email: data.email || '',
        needs: data.needs || '',
        conversation: data.conversation || [],
        source: data.source || 'webchat',
      },
    })
  }

  async findAll() {
    return this.prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: number) {
    return this.prisma.lead.findUnique({ where: { id } })
  }

  async updateStatus(id: number, status: string, notes?: string) {
    return this.prisma.lead.update({
      where: { id },
      data: { status, ...(notes !== undefined ? { notes } : {}) },
    })
  }

  async getStats() {
    const all = await this.prisma.lead.findMany()
    return {
      total: all.length,
      yeni: all.filter(l => l.status === 'yeni').length,
      contact: all.filter(l => l.status === 'contact').length,
      converted: all.filter(l => l.status === 'converted').length,
    }
  }
}
