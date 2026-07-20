import { Injectable } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class ConfigService {
  private configPath = path.join(process.cwd(), 'data', 'config.json')
  private cache: Record<string, string> = {}

  constructor() {
    this.load()
  }

  private load() {
    try {
      if (fs.existsSync(this.configPath)) {
        this.cache = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
      }
    } catch {}
  }

  private save() {
    try {
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.configPath, JSON.stringify(this.cache, null, 2))
    } catch {}
  }

  get(key: string, defaultValue = ''): string {
    return this.cache[key] || process.env[key] || defaultValue
  }

  set(key: string, value: string) {
    this.cache[key] = value
    this.save()
  }

  keys(prefix?: string): string[] {
    const allKeys = Object.keys(this.cache)
    if (!prefix) return allKeys
    return allKeys.filter(k => k.startsWith(prefix))
  }
}
