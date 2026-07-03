import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import * as cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { SecurityExceptionFilter } from './security-exception.filter'
import { SecurityLoggerService } from './auth/security-logger.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
  app.use(cookieParser())

  app.enableCors({
    origin: [
      'https://bruskapp.com',
      'https://www.bruskapp.com',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  const securityLogger = app.get(SecurityLoggerService)
  app.useGlobalFilters(new SecurityExceptionFilter(securityLogger))

  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  await app.listen(process.env.PORT || 4000)
}
bootstrap()
