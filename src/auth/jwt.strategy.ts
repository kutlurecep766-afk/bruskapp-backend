import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { Request } from 'express'
import { PrismaService } from '../prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => req?.cookies?.access_token || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
      algorithms: ['HS256'],
    } as any)
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return { userId: payload.sub, email: payload.email, role: 'USER', permissions: [], tenantId: '' }
    return { userId: user.id, email: user.email, role: user.role, permissions: user.permissions, name: user.name, tenantId: user.tenantId }
  }
}
