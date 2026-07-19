import { Controller, Post, Get, Body, Res, Req, HttpCode, HttpStatus, UnauthorizedException, Query, UseGuards } from '@nestjs/common'
import { Response, Request } from 'express'
import { AuthService } from './auth.service'
import { PrismaService } from '../prisma.service'
import { AuthGuard } from '@nestjs/passport'
import { Public } from './public.decorator'
import { SetupDto } from './dto/setup.dto'
import { LoginDto } from './dto/login.dto'
import { Verify2faDto } from './dto/verify-2fa.dto'
import { RegisterDto } from './dto/register.dto'
import { SecurityLoggerService } from './security-logger.service'

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private securityLogger: SecurityLoggerService,
  ) {}

  @Public()
  @Get('status')
  async getStatus() {
    return this.authService.getStatus()
  }

  @Public()
  @Get('security-alerts')
  async getSecurityAlerts(@Query('minutes') minutes?: string) {
    return { alerts: this.securityLogger.getRecentAlerts(minutes ? parseInt(minutes, 10) : 60) }
  }

  @Public()
  @Post('setup')
  async setup(@Body() dto: SetupDto) {
    return this.authService.setup(dto.email, dto.password)
  }

  @Public()
  @Post('token-login')
  @HttpCode(HttpStatus.OK)
  async tokenLogin(@Req() req: Request, @Body() dto: LoginDto) {
    const ip = (req.ip || req.socket?.remoteAddress || '') as string
    const user = await this.authService.validateLogin(dto.email, dto.password, ip)
    if (!user) {
      throw new UnauthorizedException('Email veya sifre hatali')
    }
    const result = await this.authService.login(user)
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.userId } })
    await this.prisma.loginAttempt.create({ data: { email: dto.email, success: true, ip, userId: user.userId } })
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, user: { userId: user.userId, email: user.email, name: user.name || '', role: dbUser?.role || 'USER', tenantId: dbUser?.tenantId || null } }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: Request, @Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const ip = (req.ip || req.socket?.remoteAddress || '') as string
    const user = await this.authService.validateLogin(dto.email, dto.password, ip)
    if (!user) {
      this.securityLogger.logFailedAuth(ip, dto.email, 'gecersiz-kimlik')
      throw new UnauthorizedException('Email veya sifre hatali')
    }
    const result = await this.authService.login(user)
    res.cookie('access_token', result.accessToken, {
      httpOnly: true, secure: true, sameSite: 'strict',
      path: '/',
    })
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true, secure: true, sameSite: 'strict',
      path: '/api/auth',
    })
    const has2fa = await this.authService.hasTwoFactorEnabled(user.userId)
    if (has2fa) {
      return { twoFactorRequired: true }
    }
    await this.prisma.loginAttempt.create({ data: { email: dto.email, success: true, ip, userId: user.userId } })
    return { success: true }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.['refresh_token']
    if (!refreshToken) throw new UnauthorizedException('Refresh token bulunamadi')
    const result = await this.authService.refresh(refreshToken)
    res.cookie('access_token', result.accessToken, {
      httpOnly: true, secure: true, sameSite: 'strict',
      path: '/',
    })
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true, secure: true, sameSite: 'strict',
      path: '/api/auth',
    })
    return { success: true }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.['refresh_token']
    if (refreshToken) await this.authService.logout(refreshToken)
    res.clearCookie('access_token', { path: '/' })
    res.clearCookie('refresh_token', { path: '/api/auth' })
    return { success: true }
  }

  @Get('2fa/status')
  async get2faStatus(@Req() req: Request) {
    const user = req.user as any
    return this.authService.get2faStatus(user.userId)
  }

  @Post('2fa/setup')
  async setup2fa(@Req() req: Request) {
    const user = req.user as any
    return this.authService.setup2fa(user.userId)
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2fa(@Req() req: Request, @Body() dto: Verify2faDto) {
    const userId = req.user ? (req.user as any).userId : undefined
    if (!userId && !dto.email) {
      throw new UnauthorizedException('Oturum bulunamadi')
    }
    const valid = await this.authService.verify2fa(userId, dto.token, dto.email)
    if (!valid) throw new UnauthorizedException('Gecersiz kod')
    return { success: true }
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.businessName, dto.email, dto.password)
  }

  @Get('attempts')
  @UseGuards(AuthGuard('jwt'))
  async getLoginAttempts(@Query('limit') limit?: string) {
    return this.authService.getLoginAttempts(limit ? parseInt(limit, 10) : 20)
  }
}
