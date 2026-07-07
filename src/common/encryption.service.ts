import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_HEX_LENGTH = 64
const SENSITIVE_FIELDS = ['apiKey', 'apiSecret', 'apiSecretKey', 'clientSecret', 'password', 'token']

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name)
  private key: Buffer

  constructor() {
    const raw = process.env.ENCRYPTION_KEY
    if (!raw || raw.length !== KEY_HEX_LENGTH) {
      throw new Error(`ENCRYPTION_KEY must be a ${KEY_HEX_LENGTH}-char hex string`)
    }
    this.key = Buffer.from(raw, 'hex')
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv)
    let enc = cipher.update(plainText, 'utf8', 'hex')
    enc += cipher.final('hex')
    const tag = cipher.getAuthTag().toString('hex')
    return `${iv.toString('hex')}:${tag}:${enc}`
  }

  decrypt(encrypted: string): string {
    try {
      const parts = encrypted.split(':')
      if (parts.length !== 3) return encrypted
      const iv = Buffer.from(parts[0], 'hex')
      const tag = Buffer.from(parts[1], 'hex')
      const data = parts[2]
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv)
      decipher.setAuthTag(tag)
      let dec = decipher.update(data, 'hex', 'utf8')
      dec += decipher.final('utf8')
      return dec
    } catch {
      return encrypted
    }
  }

  encryptConfig(config: Record<string, any>): Record<string, any> {
    const out = { ...config }
    for (const key of SENSITIVE_FIELDS) {
      if (typeof out[key] === 'string' && out[key].length > 0) {
        out[key] = this.encrypt(out[key])
      }
    }
    return out
  }

  decryptConfig(config: Record<string, any>): Record<string, any> {
    const out = { ...config }
    for (const key of SENSITIVE_FIELDS) {
      if (typeof out[key] === 'string' && out[key].includes(':')) {
        out[key] = this.decrypt(out[key])
      }
    }
    return out
  }
}
