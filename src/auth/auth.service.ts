import { Injectable, HttpException, HttpStatus, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import * as speakeasy from 'speakeasy'
import * as QRCode from 'qrcode'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma.service'

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async getStatus(): Promise<{ adminSetup: boolean }> {
    const admin = await this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    return { adminSetup: !!admin }
  }

  async setup(email: string, password: string): Promise<{ success: boolean }> {
    const existing = await this.prisma.user.findFirst()
    if (existing) throw new UnauthorizedException('Admin zaten kurulu')
    const passwordHash = await bcrypt.hash(password, 12)
    // Create default tenant + admin user
    const tenant = await this.prisma.tenant.create({
      data: { name: 'Default', slug: 'default' },
    })
    await this.prisma.user.create({
      data: { email, passwordHash, tenantId: tenant.id, role: 'SUPER_ADMIN' },
    })
    return { success: true }
  }

  async validateLogin(email: string, password: string, ip?: string): Promise<any | null> {
    const admin = await this.prisma.user.findUnique({ where: { email } })
    if (!admin) {
      await this.prisma.loginAttempt.create({ data: { email, success: false, ip } })
      return null
    }
    if (admin.status === 'restricted') {
      await this.prisma.loginAttempt.create({ data: { email, success: false, ip, userId: admin.id } })
      throw new HttpException('Hesabınız kısıtlanmıştır. Destek ekibiyle iletişime geçin.', HttpStatus.FORBIDDEN)
    }
    if (admin.bruteForceBannedAt && admin.bruteForceBannedAt > new Date()) {
      await this.prisma.loginAttempt.create({ data: { email, success: false, ip, userId: admin.id } })
      return null
    }
    const valid = await bcrypt.compare(password, admin.passwordHash)
    if (!valid) {
      const attempts = admin.bruteForceAttempts + 1
      const bannedAt = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
      await this.prisma.user.update({
        where: { id: admin.id },
        data: { bruteForceAttempts: bannedAt ? 0 : attempts, bruteForceBannedAt: bannedAt },
      })
      await this.prisma.loginAttempt.create({ data: { email, success: false, ip, userId: admin.id } })
      return null
    }
    await this.prisma.user.update({
      where: { id: admin.id },
      data: { bruteForceAttempts: 0, bruteForceBannedAt: null },
    })
    return { userId: admin.id, email: admin.email }
  }

  async login(user: any): Promise<{ accessToken: string; refreshToken: string; user?: any }> {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.userId } })
    const payload = { sub: user.userId, email: user.email, role: dbUser?.role || 'USER', permissions: dbUser?.permissions || [], name: dbUser?.name || '' }
    const accessToken = this.jwtService.sign(payload)
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '12h' })
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.userId },
    })
    return { accessToken, refreshToken }
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { token: refreshToken } })
    if (!stored) throw new UnauthorizedException('Gecersiz refresh token')
    await this.prisma.refreshToken.delete({ where: { id: stored.id } })
    let payload: any
    try { payload = this.jwtService.verify(refreshToken) } catch {
      throw new UnauthorizedException('Token suresi dolmus')
    }
    const dbUser = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    const newPayload = { sub: payload.sub, email: payload.email, role: dbUser?.role || 'USER', permissions: dbUser?.permissions || [], name: dbUser?.name || '' }
    const newAccessToken = this.jwtService.sign(newPayload)
    const newRefreshToken = this.jwtService.sign(newPayload, { expiresIn: '12h' })
    await this.prisma.refreshToken.create({
      data: { token: newRefreshToken, userId: payload.sub },
    })
    return { accessToken: newAccessToken, refreshToken: newRefreshToken }
  }

  async logout(refreshToken: string): Promise<{ success: boolean }> {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
    return { success: true }
  }

  async get2faStatus(userId: string): Promise<{ setup: boolean }> {
    const secret = await this.prisma.twoFactorSecret.findUnique({ where: { userId } })
    return { setup: !!secret?.verified }
  }

  
  async getLoginAttempts(limit = 20): Promise<any[]> {
    return this.prisma.loginAttempt.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async hasTwoFactorEnabled(userId: string): Promise<boolean> {
    const secret = await this.prisma.twoFactorSecret.findUnique({ where: { userId } })
    return !!(secret?.verified)
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) return false
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) return false
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    return true
  }

  async register(businessName: string, email: string, password: string): Promise<{ slug: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) throw new UnauthorizedException('Bu e-posta zaten kayitli')
    let slug = businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'firma'
    let counter = 1
    let finalSlug = slug
    while (await this.prisma.tenant.findUnique({ where: { slug: finalSlug } })) {
      finalSlug = slug + '-' + counter++
    }
    const passwordHash = await bcrypt.hash(password, 12)
    await this.prisma.tenant.create({
      data: {
        name: businessName,
        slug: finalSlug,
        users: {
          create: { email, passwordHash, role: 'TENANT_ADMIN' },
        },
      },
    })
    return { slug: finalSlug }
  }

  async setup2fa(userId: string): Promise<{ secret: string; qrCode: string }> {
    const speakeasySecret = speakeasy.generateSecret({ name: 'bruskapp (admin)' })
    await this.prisma.twoFactorSecret.upsert({
      where: { userId },
      create: { secret: speakeasySecret.base32, userId },
      update: { secret: speakeasySecret.base32, verified: false },
    })
    const qrCode = await QRCode.toDataURL(speakeasySecret.otpauth_url!)
    return { secret: speakeasySecret.base32, qrCode }
  }

  async verify2fa(userId: string | undefined, token: string, email?: string): Promise<boolean> {
    let targetUserId = userId
    if (!targetUserId && email) {
      const user = await this.prisma.user.findUnique({ where: { email } })
      if (!user) return false
      targetUserId = user.id
    }
    const data = await this.prisma.twoFactorSecret.findUnique({ where: { userId: targetUserId } })
    if (!data) return false
    const valid = speakeasy.totp.verify({ secret: data.secret, encoding: 'base32', token, window: 4 })
    if (valid) {
      await this.prisma.twoFactorSecret.update({
        where: { userId: targetUserId },
        data: { verified: true },
      })
    }
    return valid
  }
}