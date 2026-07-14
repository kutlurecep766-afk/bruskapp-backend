import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import * as webpush from 'web-push'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'


@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name)
  private subscriptions: Array<{ tenantId: string; endpoint: string; keys: { p256dh: string; auth: string } }> = []
  private fcmTokens: Array<{ tenantId: string; token: string }> = []
  private readonly filePath: string
  private readonly fcmPath: string
  private vapidKeys: { publicKey: string; privateKey: string }

  constructor(private readonly http: HttpService) {
    this.filePath = path.join(process.cwd(), 'data', 'push-subscriptions.json')
    this.fcmPath = path.join(process.cwd(), 'data', 'fcm-tokens.json')
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
    try {
      if (fs.existsSync(this.fcmPath)) {
        this.fcmTokens = JSON.parse(fs.readFileSync(this.fcmPath, 'utf-8'))
      }
    } catch {}
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.subscriptions))
      fs.writeFileSync(this.fcmPath, JSON.stringify(this.fcmTokens))
    } catch {}
  }

  subscribe(tenantId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    const idx = this.subscriptions.findIndex(s => s.endpoint === sub.endpoint)
    if (idx >= 0) this.subscriptions[idx] = { tenantId, ...sub }
    else this.subscriptions.push({ tenantId, ...sub })
    this.save()
  }

  registerFcm(token: string, tenantId = '') {
    const idx = this.fcmTokens.findIndex(t => t.token === token)
    if (idx >= 0) this.fcmTokens[idx] = { token, tenantId }
    else this.fcmTokens.push({ token, tenantId })
    this.save()
  }

  private fcmApp: any = null

  private getFcmApp() {
    if (this.fcmApp) return this.fcmApp
    const keyPath = path.join(process.cwd(), 'data', 'firebase-key.json')
    if (!fs.existsSync(keyPath)) return null
    try {
      const key = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
      const admin = require('firebase-admin')
      if (admin.apps.length === 0) {
        this.fcmApp = admin.initializeApp({ credential: admin.credential.cert(key) })
      } else {
        this.fcmApp = admin.apps[0]
      }
      return this.fcmApp
    } catch { return null }
  }

  async notify(tenantId: string, payload: { title: string; body: string; icon?: string }) {
    const subs = this.subscriptions.filter(s => s.tenantId === tenantId)
    if (subs.length > 0) {
      Promise.all(subs.map(sub =>
        webpush.sendNotification(sub, JSON.stringify(payload)).catch((e: any) => {
          if (e.statusCode === 410 || e.statusCode === 404) {
            this.subscriptions = this.subscriptions.filter(s => s.endpoint !== sub.endpoint)
            this.save()
          }
        })
      )).catch(() => {})
    }
    const fcmSubs = this.fcmTokens.filter(t => !tenantId || t.tenantId === tenantId)
    if (fcmSubs.length > 0) {
      const app = this.getFcmApp()
      if (app) {
        Promise.all(fcmSubs.map(t =>
          app.messaging().send({
            token: t.token,
            notification: { title: payload.title, body: payload.body },
            android: { notification: { icon: payload.icon || '', channelId: 'default' } },
          }).catch(() => {})
        )).catch(() => {})
      }
    }
  }
}
