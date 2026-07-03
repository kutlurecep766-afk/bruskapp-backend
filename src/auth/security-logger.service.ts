import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger('Security')
  private logPath: string

  constructor() {
    this.logPath = path.join(process.cwd(), 'data', 'security.log')
    const dir = path.dirname(this.logPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  private write(entry: string) {
    try {
      fs.appendFileSync(this.logPath, entry + '\n')
    } catch {}
  }

  logRateLimit(ip: string, path: string, method: string) {
    const ts = new Date().toISOString()
    const msg = `[RATE_LIMIT] ${ts} IP:${ip} ${method} ${path}`
    this.logger.warn(msg)
    this.write(msg)
  }

  logFailedAuth(ip: string, email: string, reason: string) {
    const ts = new Date().toISOString()
    const msg = `[FAILED_AUTH] ${ts} IP:${ip} Email:${email} Reason:${reason}`
    this.logger.warn(msg)
    this.write(msg)
  }

  logFailedJwt(ip: string, path: string) {
    const ts = new Date().toISOString()
    const msg = `[FAILED_JWT] ${ts} IP:${ip} Path:${path}`
    this.logger.warn(msg)
    this.write(msg)
  }

  getRecentAlerts(minutes = 60): string[] {
    try {
      if (!fs.existsSync(this.logPath)) return []
      const content = fs.readFileSync(this.logPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      const cutoff = Date.now() - minutes * 60 * 1000
      return lines.filter(l => {
        const match = l.match(/\[.*?\] (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
        if (!match) return false
        return new Date(match[1]).getTime() > cutoff
      }).slice(-20)
    } catch {
      return []
    }
  }
}
