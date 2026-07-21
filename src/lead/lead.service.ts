import { Injectable, NotFoundException } from '@nestjs/common'
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
    tenantId?: string
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
        tenantId: data.tenantId,
      },
    })
  }

  async findAll(tenantId: string) {
    const leads = await this.prisma.lead.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    return leads.map(l => ({
      ...l,
      hasAiReply: (l.conversation as any[])?.some((m: any) => m.role === 'assistant') || false,
    }))
  }

  async findOne(id: number, tenantId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
    })
    if (!lead) throw new NotFoundException('Lead bulunamadi')
    return lead
  }

  async updateStatus(id: number, status: string, tenantId: string, notes?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
    })
    if (!lead) throw new NotFoundException('Lead bulunamadi')
    return this.prisma.lead.update({
      where: { id },
      data: { status, ...(notes !== undefined ? { notes } : {}) },
    })
  }

  async getStats(tenantId: string) {
    const all = await this.prisma.lead.findMany({ where: { tenantId } })
    return {
      total: all.length,
      yeni: all.filter(l => l.status === 'yeni').length,
      contact: all.filter(l => l.status === 'contact').length,
      converted: all.filter(l => l.status === 'converted').length,
    }
  }
}
