import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import * as webpush from 'web-push'

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name)
  private subscriptions: Array<{ tenantId: string; endpoint: string; keys: { p256dh: string; auth: string } }> = []
  private readonly filePath: string
  private vapidKeys: { publicKey: string; privateKey: string }

  constructor() {
    this.filePath = path.join(process.cwd(), 'data', 'push-subscriptions.json')
    const keyPath = path.join(process.cwd(), 'data', 'vapid-keys.json')
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      this.vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    } else if (fs.existsSync(keyPath)) {
      this.vapidKeys = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
    } else {
      this.vapidKeys = webpush.generateVAPIDKeys()
      fs.mkdirSync(path.dirname(keyPath), { recursive: true })
      fs.writeFileSync(keyPath, JSON.stringify(this.vapidKeys))
    }
    this.load()
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      this.vapidKeys = {
        publicKey: process.env.VAPID_PUBLIC_KEY,
        privateKey: process.env.VAPID_PRIVATE_KEY,
      }
    }
    webpush.setVapidDetails('mailto:info@bruskapp.com', this.vapidKeys.publicKey, this.vapidKeys.privateKey)
  }

  getPublicKey() { return this.vapidKeys.publicKey }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.subscriptions = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch {}
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.subscriptions))
    } catch {}
  }

  subscribe(tenantId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    const idx = this.subscriptions.findIndex(s => s.endpoint === sub.endpoint)
    if (idx >= 0) this.subscriptions[idx] = { tenantId, ...sub }
    else this.subscriptions.push({ tenantId, ...sub })
    this.save()
  }

  async notify(tenantId: string, payload: { title: string; body: string; icon?: string }) {
    const subs = this.subscriptions.filter(s => s.tenantId === tenantId)
    if (subs.length === 0) return
    Promise.all(subs.map(sub =>
      webpush.sendNotification(sub, JSON.stringify(payload)).catch((e: any) => {
        if (e.statusCode === 410 || e.statusCode === 404) {
          this.subscriptions = this.subscriptions.filter(s => s.endpoint !== sub.endpoint)
          this.save()
        }
      })
    )).catch(() => {})
  }
}
