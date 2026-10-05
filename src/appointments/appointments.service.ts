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

  async updateStatus(id: number, status: string, tenantId: string) {
    return this.prisma.appointment.update({ where: { id, tenantId }, data: { status } })
  }

  async update(id: number, tenantId: string, data: { customerName?: string; customerContact?: string; date?: string; time?: string; service?: string; notes?: string }) {
    const patch: any = {}
    if (data.customerName !== undefined) patch.customerName = data.customerName
    if (data.customerContact !== undefined) patch.customerContact = data.customerContact
    if (data.time !== undefined) patch.time = data.time
    if (data.service !== undefined) patch.service = data.service
    if (data.notes !== undefined) patch.notes = data.notes
    if (data.date !== undefined) {
      const d = new Date(data.date)
      if (!isNaN(d.getTime())) patch.date = d
    }
    return this.prisma.appointment.update({ where: { id, tenantId }, data: patch })
  }

  async cancel(id: number, tenantId: string, notes?: string) {
    return this.prisma.appointment.update({ where: { id, tenantId }, data: { status: 'cancelled', notes: notes || undefined } })
  }
}
