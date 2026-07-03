import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Inject } from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import { SecurityLoggerService } from './auth/security-logger.service'
import { Response, Request } from 'express'

@Catch()
export class SecurityExceptionFilter implements ExceptionFilter {
  constructor(@Inject(SecurityLoggerService) private securityLogger: SecurityLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const ip = request.ip || request.socket.remoteAddress || 'unknown'

    if (exception instanceof ThrottlerException) {
      this.securityLogger.logRateLimit(ip, request.path, request.method)
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus()
      if (status === 401) {
        const path = request.path || '/'
        if (!path.includes('/auth/login')) {
          this.securityLogger.logFailedJwt(ip, path)
        }
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse()
      response.status(status).json(typeof res === 'string' ? { message: res } : res)
    } else {
      console.error('Unhandled exception:', exception)
      response.status(500).json({ message: 'Internal server error' })
    }
  }
}
