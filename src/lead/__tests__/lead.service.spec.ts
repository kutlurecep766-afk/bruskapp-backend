import { Test, TestingModule } from '@nestjs/testing'
import { LeadService } from '../lead.service'
import { PrismaService } from '../../prisma.service'

describe('LeadService', () => {
  let service: LeadService
  let prisma: any

  const mockPrisma = {
    lead: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LeadService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()
    service = module.get<LeadService>(LeadService)
    prisma = module.get(PrismaService)
  })

  it('should be defined', () => { expect(service).toBeDefined() })

  describe('findAll', () => {
    it('should filter by tenantId', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([])
      await service.findAll('tenant-1')
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-1' } }))
    })

    it('should return leads with hasAiReply', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([
        { id: 1, conversation: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] },
        { id: 2, conversation: [{ role: 'user', content: 'hi' }] },
      ])
      const result = await service.findAll('t1')
      expect(result[0].hasAiReply).toBe(true)
      expect(result[1].hasAiReply).toBe(false)
    })
  })

  describe('create', () => {
    it('should create a lead with tenantId', async () => {
      const data = { sessionId: 's1', name: 'Test', phone: '555', needs: 'test', conversation: [], tenantId: 't1' }
      mockPrisma.lead.create.mockResolvedValue({ id: 1, ...data })
      await service.create(data)
      expect(mockPrisma.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 't1' }) })
    })
  })

  describe('findOne', () => {
    it('should reject if lead not in tenant', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null)
      await expect(service.findOne(999, 'tenant-1')).rejects.toThrow('Lead bulunamadi')
      expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith({ where: { id: 999, tenantId: 'tenant-1' } })
    })
  })

  describe('getStats', () => {
    it('should filter by tenantId', async () => {
      mockPrisma.lead.findMany.mockResolvedValue([{ status: 'yeni' }, { status: 'yeni' }, { status: 'contact' }])
      const result = await service.getStats('t1')
      expect(mockPrisma.lead.findMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } })
      expect(result.total).toBe(3)
      expect(result.yeni).toBe(2)
    })
  })
})
