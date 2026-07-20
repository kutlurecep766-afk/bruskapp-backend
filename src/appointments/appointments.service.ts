import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(data: { tenantId: string; platform?: string; customerName: string; customerContact?: string; date: string; time?: string; service?: string; notes?: string }) {
    return this.prisma.appointment.create({
      data: {
        tenantId: data.tenantId,
        platform: data.platform || 'webchat',
        customerName: data.customerName,
        customerContact: data.customerContact || '',
        date: new Date(data.date),
        time: data.time || '',
        service: data.service || '',
        notes: data.notes || '',
        status: 'pending',
      },
    })
  }

  async findAll(tenantId: string) {
    return this.prisma.appointment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async updateStatus(id: number, status: string) {
    return this.prisma.appointment.update({ where: { id }, data: { status } })
  }
}
