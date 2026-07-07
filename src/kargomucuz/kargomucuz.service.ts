import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { PrismaService } from '../prisma.service'
import { EncryptionService } from '../common/encryption.service'
import { firstValueFrom } from 'rxjs'
import type { KargoMucuzCredentials, KargoMucuzProvider, CreateShipmentDto } from './kargomucuz.types'

@Injectable()
export class KargomucuzService {
  private readonly logger = new Logger(KargomucuzService.name)
  private readonly apiUrl = 'https://api.kargomucuz.com/v1'
  private tokenCache = new Map<string, { token: string; userId: string; expiresAt: number }>()

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private async getCredentials(tenantId: string): Promise<KargoMucuzCredentials> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const keys = this.encryption.decryptConfig((tenant?.marketplaceApiKeys as any)?.kargomucuz || {})
    if (!keys?.email || !keys?.password) {
      throw new HttpException('KargoMucuz giriş bilgileri tanımlanmamış. Lütfen ayarlardan ekleyin.', HttpStatus.BAD_REQUEST)
    }
    return keys as KargoMucuzCredentials
  }

  private async login(tenantId: string): Promise<{ token: string; userId: string }> {
    const cached = this.tokenCache.get(tenantId)
    if (cached && cached.expiresAt > Date.now()) {
      return { token: cached.token, userId: cached.userId }
    }

    const creds = await this.getCredentials(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.post(this.apiUrl + '/auth/sign-in', {
          email: creds.email,
          password: creds.password,
        })
      )
    } catch (e: any) {
      throw new HttpException('KargoMucuz giris hatasi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }

    if (!res.data?.status || !res.data?.payload?.data?.accessToken) {
      throw new HttpException('KargoMucuz giris basarisiz: ' + (res.data?.message || 'bilinmeyen hata'), HttpStatus.UNAUTHORIZED)
    }

    const token = res.data.payload.data.accessToken
    const userId = res.data.payload.data.refinedUserData?._id || '0'
    this.tokenCache.set(tenantId, { token, userId, expiresAt: Date.now() + 3600000 })
    return { token, userId }
  }

  async saveCredentials(tenantId: string, dto: { email: string; password: string }): Promise<{ success: boolean; message: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    current.kargomucuz = this.encryption.encryptConfig({ email: dto.email, password: dto.password })
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: current },
    })
    return this.testConnection(tenantId)
  }

  async testConnection(tenantId: string): Promise<{ success: boolean; message: string }> {
    try {
      const { token } = await this.login(tenantId)
      await firstValueFrom(
        this.http.get(this.apiUrl + '/shipments/providers', {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
      return { success: true, message: 'Ba\u011flant\u0131 ba\u015far\u0131l\u0131' }
    } catch (e: any) {
      return { success: false, message: e?.response?.data?.message || e?.message || 'Ba\u011flant\u0131 hatas\u0131' }
    }
  }

  async getProviders(tenantId: string, type?: string): Promise<KargoMucuzProvider[]> {
    const { token } = await this.login(tenantId)
    const params: any = {}
    if (type) params.type = type
    let res
    try {
      res = await firstValueFrom(
        this.http.get(this.apiUrl + '/shipments/providers', {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          params,
        })
      )
    } catch (e: any) {
      throw new HttpException('Kargo firmalari alinamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data || []
  }

  async createAddress(tenantId: string, dto: any) {
    const { token, userId } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.post(this.apiUrl + '/addresses/' + userId, dto, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Adres olusturulamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    if (!res.data?.status) {
      throw new HttpException('Adres olusturulamadi: ' + (res.data?.message || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    }
    return res.data.payload
  }

  async getAddresses(tenantId: string, type?: string) {
    const { token, userId } = await this.login(tenantId)
    const endpoint = type === 'sender'
      ? this.apiUrl + '/addresses/sender'
      : type === 'receiver'
        ? this.apiUrl + '/addresses/receiver-detail'
        : this.apiUrl + '/addresses/' + userId
    let res
    try {
      res = await firstValueFrom(
        this.http.get(endpoint, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Adresler alinamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data || []
  }

  async createShipment(tenantId: string, dto: any) {
    const { token, userId } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.post(this.apiUrl + '/shipments/' + userId, dto, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Kargo olusturulamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    if (!res.data?.status) {
      throw new HttpException('Kargo olusturulamadi: ' + (res.data?.message || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    }
    return res.data.payload
  }

  async listShipments(tenantId: string) {
    const { token, userId } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.get(this.apiUrl + '/shipments/' + userId, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Gonderiler alinamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data || []
  }

  async trackShipment(tenantId: string, trackingId: string) {
    const { token, userId } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.get(this.apiUrl + '/shipments/traces/' + userId + '/' + trackingId, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Takip bilgisi alinamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data || { refinedTraces: {}, handlerTraces: {} }
  }

  async cancelShipment(tenantId: string, shipmentTransactionId: string) {
    const { token, userId } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.delete(this.apiUrl + '/shipments/' + userId, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          data: { shipmentTransactionId },
        })
      )
    } catch (e: any) {
      throw new HttpException('Iptal basarisiz: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data
  }

  async calculatePrice(tenantId: string, providerServiceCode: string, desiOrKg: string) {
    const { token } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.get(this.apiUrl + '/shipments/desi-or-kgs', {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          params: { providerServiceCode, desiOrKg },
        })
      )
    } catch (e: any) {
      throw new HttpException('Fiyat hesaplanamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data || []
  }

  async getProvidersDetail(tenantId: string, providerId: string) {
    const { token } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.get(this.apiUrl + '/shipments/providers/detail/' + providerId, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Firma detayi alinamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data
  }

  async getWalletBalance(tenantId: string) {
    const { token, userId } = await this.login(tenantId)
    let res
    try {
      res = await firstValueFrom(
        this.http.get(this.apiUrl + '/accounts/wallet/' + userId, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Bakiye bilgisi alinamadi: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    return res.data?.payload?.data
  }
}
