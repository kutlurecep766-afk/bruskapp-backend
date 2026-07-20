import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class ReservationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: { tenantId: string; platform?: string; customerName: string; customerContact?: string; date: string; time?: string; guests?: number; tableNumber?: number; notes?: string }) {
    return this.prisma.reservation.create({
      data: {
        tenantId: data.tenantId,
        platform: data.platform || 'webchat',
        customerName: data.customerName,
        customerContact: data.customerContact || '',
        date: new Date(data.date),
        time: data.time || '',
        guests: data.guests || 2,
        tableNumber: data.tableNumber || null,
        notes: data.notes || '',
        status: 'pending',
      },
    })
  }

  async findAll(tenantId: string) {
    return this.prisma.reservation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async updateStatus(id: number, status: string) {
    return this.prisma.reservation.update({ where: { id }, data: { status } })
  }
}
