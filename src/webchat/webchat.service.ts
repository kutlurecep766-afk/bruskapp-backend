import { Injectable, Inject, forwardRef, Optional, Logger } from '@nestjs/common'
import { TenantsService } from '../tenants/tenants.service'
import { PrismaService } from '../prisma.service'
import { OrdersService } from '../orders/orders.service'
import { AppointmentsService } from '../appointments/appointments.service'
import { ReservationsService } from '../reservations/reservations.service'
import { MessagesService } from '../messages/messages.service'

export interface Product {
  name: string
  price: string
  description: string
  unit?: string
  options?: { name: string; price?: string }[]
  soldOut?: boolean
}

export interface Service {
  name: string
  duration?: string
  price?: string
}

export interface ChatSettings {
  requireName?: boolean
  requirePhone?: boolean
  requireAddress?: boolean
  requireLocation?: boolean
  requireNote?: boolean
  requireService?: boolean
  requireDate?: boolean
  requireTime?: boolean
}

export interface FAQ {
  question: string
  answer: string
}

export interface FeedSettings {
  priorityKinds?: string[]
  includeKinds?: string[]
}

export interface UnknownQuestion {
  id: string
  question: string
  platform?: string
  count: number
  answered: boolean
  answer?: string
  dismissed?: boolean
  context?: string
  createdAt: string
  answeredAt?: string
}

export interface ChatBotConfig {
  businessName: string
  description: string
  address: string
  phone: string
  hours: string
  email: string
  welcomeMessage: string
  products: Product[]
  services?: Service[]
  orderSettings?: ChatSettings
  appointmentSettings?: ChatSettings
  faqs: FAQ[]
  systemPrompt: string
  knowledgeBase: string
  modes?: { orders?: boolean; appointments?: boolean; reservations?: boolean }
  feedSettings?: FeedSettings
  unknownQuestions?: UnknownQuestion[]
  configUpdatedAt?: string
  changeLog?: { at: string; note: string }[]
  memories?: Record<string, { summary: string; at: string }>
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface Conversation {
  messages: Message[]
  lastActivity: number
}

const MAX_MSG_LENGTH = 2000
const MAX_CONV_MSGS = 50
const RATE_LIMIT_WINDOW = 60000
const RATE_LIMIT_MAX = 20
const AI_TIMEOUT = 30000

const HARMFUL_PATTERNS = [
  /yasa d[iı][sş][ıi]/i, /yasad[sş][ıi][zcs]/i, /hukuka ayk[iı]r[iı]/i,
  /müşteri bilgilerini [çc]al/i, /kullanıcı verilerini sat/i,
  /doland[iı]r[iı]c[iı]/i, /güvenlik a[cç][ıi]ğ[iı]/i, /a[cç][ıi]k kap[iı]/i,
]

const DEFAULT_CONFIG: ChatBotConfig = {
  businessName: 'Bruskapp',
  description: 'Yapay zeka destekli işletme otomasyon platformu',
  address: 'İstanbul, Türkiye',
  phone: '',
  hours: 'Hafta içi 09:00 - 18:00',
  email: 'info@bruskapp.com',
  welcomeMessage: 'Merhaba! Bruskapp AI asistanına hoş geldiniz. Size nasıl yardımcı olabilirim? CRM, chatbot, sesli asistan, QR menü ve diğer çözümlerimiz hakkında bilgi alabilirsiniz.',
  products: [],
  faqs: [],
  systemPrompt: '',
  knowledgeBase: '',
  feedSettings: {
    priorityKinds: ['order', 'appointment', 'reservation', 'request'],
    includeKinds: ['order', 'appointment', 'reservation', 'request', 'complaint', 'question'],
  },
  unknownQuestions: [],
}

const LEGACY_WELCOME = 'Merhaba! Bruskapp AI asistan'

const TRAIN_SYSTEM = `Sen Bruskapp platformunun yapay zeka KURULUM ASISTANISIN.
Gorev: Isletme sahibiyle Turkce sohbet ederek isletmesini, urunlerini, hizmetlerini, kurallarini ve SSS'lerini ogrenmek ve ogrendiklerini sistem konfigurasyonuna kaydetmek.

Davranis:
- Sicak, nazik, kisa ve net konus. Gereksiz uzun yazma.
- Isletme sahibi bilgi verdikce eksik kalan ONEMLI bilgileri SORARAK netlestir: isletme adi, ne sattigi/aciklamasi, urun veya hizmet + fiyat, calisma saatleri, adres, telefon, siparis/teslimat/odeme kurallari, randevu kurallari, sik sorulan sorular.
- Ayni bilgiyi tekrar sorma; sadece eksikleri sor. Kullanici "hepsi bu" derse ozet gec ve bitir.
- BILDIRIMLERIM AYARI: Isletme sahibine "Bildirimlerim" sayfasina hangi turlerin dusecegini (includeKinds) ve hangilerinin "Oncelikli" bolumunde gorunecegini (priorityKinds) sor. Turler: siparis (order), randevu (appointment), rezervasyon (reservation), talep (request), sikayet (complaint), en cok sorulan soru (question). Ornek istek: "siparisler ve en cok sorulan sorular dussun, siparisler oncelikli olsun" → "feedSettings": { "includeKinds": ["order","question"], "priorityKinds": ["order"] }. includeKinds sayfada gorunecek turlerdir; priorityKinds oncelikli bolumde gorunecek turlerdir ve includeKinds icinde olmalidir. Verilmezse varsayilan includeKinds: order, appointment, reservation, request, complaint, question; varsayilan priorityKinds: order, appointment, reservation, request.
- Emin olmadigin bilgiyi ASLA uydurma.
- Markdown/isaretleme KULLANMA: yildiz (** veya *), kare (#), alt cizgi ve ters tirnak ile vurgulama YAPMA. Madde listesi verirken satirlari "- " yerine "• " ile baslat veya duz cumle halinde yaz.
- Sen sadece bu isletmenin kurulum asistanisin. Bruskapp platformundan veya platform urunlerinden (CRM, chatbot, sesli asistan, QR menu vb.) ASLA bahsetme.
- Isletme adini ve ne yaptigini (description) ogrendiginde mutlaka CONFIG bloguna yaz. description kisa ve isletmeye ozgu olsun (orn. "Doner ve durum satan restoran").

Her mesajinda SADECE su iki bolumu uret: once kisa dogal Turkce cevap, sonra (varsa) guncellenecek konfigurasyon JSON blogu.

KONFIGURASYON BLOGU: Ogrendigin/degistirdigin bilgileri asagidaki formatta, cevabinin EN SONUNA yaz. Sadece yeni ogrenilen veya degisen alanlari koy.
[CONFIG]
{
  "businessName": "...",
  "description": "...",
  "address": "...",
  "phone": "...",
  "hours": "...",
  "email": "...",
  "welcomeMessage": "...",
  "products": [{ "name": "Urun", "price": "150 TL", "description": "", "unit": "adet", "options": [{ "name": "Aci" }], "soldOut": false }],
  "services": [{ "name": "Hizmet", "duration": "30 dk", "price": "300 TL" }],
  "orderSettings": { "requireName": true, "requirePhone": true, "requireAddress": false },
  "appointmentSettings": { "requireName": true, "requirePhone": true, "requireDate": true, "requireTime": true },
  "faqs": [{ "question": "...", "answer": "..." }],
  "systemPrompt": "...",
  "knowledgeBase": "...",
  "feedSettings": { "includeKinds": ["order", "appointment", "reservation", "request", "complaint", "question"], "priorityKinds": ["order", "appointment", "reservation", "request"] }
}
[/CONFIG]

Kurallar:
- JSON gecerli olmali; Turkce karakter kullanabilirsin. Fiyatlari sayi degil metin yaz ("150 TL").
- Yeni bilgi ogrenmediysen blok yazma, sadece soru sor.
- Sadece isletmenin kurulumuyla ilgili konus; baska konuya girme.

MEVCUT AYARLAR (bos alanlar henuz ogrenilmedi):`

@Injectable()
export class WebchatService {
  private readonly logger = new Logger(WebchatService.name)
  private conversations = new Map<string, Conversation>()
  private aiApiKey: string
  private aiModel: string
  private aiBaseUrl: string
  private lastOrderAt = new Map<string, number>()
  private pendingOrders = new Map<string, { name: string; quantity: number }[]>()
  private pendingCustomers = new Map<string, Record<string, string>>()
  private pendingAppts = new Map<string, { name?: string; phone?: string; service?: string; date?: string; time?: string; note?: string }>()
  private sessionRateMap = new Map<string, { count: number; resetAt: number }>()
  private ipRateMap = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private prisma: PrismaService,
    private tenantsService: TenantsService,
    @Optional() private ordersService?: OrdersService,
    @Optional() private appointmentsService?: AppointmentsService,
    @Optional() private reservationsService?: ReservationsService,
    @Optional() private messagesService?: MessagesService,
  ) {
    this.aiApiKey = process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
    this.aiModel = process.env.AI_MODEL || 'deepseek-chat'
    this.aiBaseUrl = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1/chat/completions'
  }

  private defaultConfig(tenantName?: string): ChatBotConfig {
    return {
      ...DEFAULT_CONFIG,
      businessName: tenantName || DEFAULT_CONFIG.businessName,
      welcomeMessage: '',
    }
  }

  private normalizeConfig(cfg: ChatBotConfig): ChatBotConfig {
    const isPlatform = (cfg.businessName || '').toLowerCase() === 'bruskapp'
    if (!isPlatform) {
      if (this.isLegacyWelcome(cfg.welcomeMessage)) cfg.welcomeMessage = ''
      if (cfg.description === DEFAULT_CONFIG.description) cfg.description = ''
      if (cfg.email === DEFAULT_CONFIG.email) cfg.email = ''
    }
    return cfg
  }

  private isLegacyWelcome(w?: string): boolean {
    if (!w) return false
    const t = w.trim()
    return t.startsWith(LEGACY_WELCOME) || t.includes('Bruskapp AI asistan')
  }

  private isStalePlatformMessage(text: string): boolean {
    const t = String(text || '')
    if (!t) return false
    if (this.isLegacyWelcome(t)) return true
    if (/bruskapp/i.test(t)) return true
    if (/yapay zeka destekli işletme otomasyon/i.test(t)) return true
    if (/(CRM|chatbot|sesli asistan|QR menü|QR menu)/i.test(t) && /(çözüm|cozum|hizmet|sunuyoruz|platform)/i.test(t)) return true
    return false
  }

  private nowTr(): string {
    try {
      return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
    } catch {
      return new Date().toLocaleString('tr-TR')
    }
  }

  private fmtDate(iso?: string): string {
    if (!iso) return ''
    try {
      return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    } catch {
      return String(iso)
    }
  }

  private recentContext(conv?: Conversation): string {
    if (!conv || !conv.messages?.length) return ''
    return conv.messages
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Müşteri' : 'Asistan'}: ${String(m.content || '').slice(0, 160)}`)
      .join('\n')
      .slice(0, 800)
  }

  async getConfig(tenantId: string): Promise<ChatBotConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webchatConfig: true, name: true },
    })

    if (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object' && Object.keys(tenant.webchatConfig as any).length > 0) {
      return this.normalizeConfig({ ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) })
    }

    return this.normalizeConfig(this.defaultConfig(tenant?.name))
  }
  async getPublicConfig(slug: string): Promise<{ businessName: string; welcomeMessage: string; products: any[] }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { webchatConfig: true, name: true },
    })
    const cfg = this.normalizeConfig(tenant?.webchatConfig && typeof tenant.webchatConfig === 'object' && Object.keys(tenant.webchatConfig as any).length > 0
      ? { ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) }
      : this.defaultConfig(tenant?.name))
    return {
      businessName: cfg.businessName,
      welcomeMessage: cfg.welcomeMessage,
      products: cfg.products,
    }
  }

  async updateConfig(tenantId: string, updates: Partial<ChatBotConfig>): Promise<ChatBotConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webchatConfig: true, name: true },
    })
    const current = this.normalizeConfig(tenant?.webchatConfig && typeof tenant.webchatConfig === 'object'
      ? { ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) }
      : this.defaultConfig(tenant?.name))
    if (!updates.knowledgeBase && current.knowledgeBase) {
      (updates as any).knowledgeBase = current.knowledgeBase
    }
    const merged = { ...current, ...updates }
    const fieldLabels: Record<string, string> = {
      businessName: 'İşletme adı', description: 'Açıklama', address: 'Adres', phone: 'Telefon',
      hours: 'Çalışma saatleri', email: 'E-posta', welcomeMessage: 'Karşılama mesajı',
      products: 'Ürünler', services: 'Hizmetler', orderSettings: 'Sipariş kuralları',
      appointmentSettings: 'Randevu kuralları', faqs: 'Sık sorulan sorular', systemPrompt: 'Sistem notu',
      knowledgeBase: 'Bilgi havuzu', modes: 'Yetenekler', feedSettings: 'Bildirim ayarları',
    }
    const changed = Object.keys(updates).filter(k => !['changeLog', 'configUpdatedAt', 'memories', 'unknownQuestions'].includes(k))
    if (changed.length) {
      const nowIso = new Date().toISOString()
      const prevLog = Array.isArray((current as any).changeLog) ? (current as any).changeLog : []
      ;(merged as any).changeLog = [...prevLog, { at: nowIso, note: 'Güncellenen alanlar: ' + changed.map(k => fieldLabels[k] || k).join(', ') }].slice(-30)
      ;(merged as any).configUpdatedAt = nowIso
    }
    const dataUpdate: any = { webchatConfig: merged as any }
    if (updates.modes) {
      const t2 = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { features: true } })
      const feats: any = (t2?.features && typeof t2.features === 'object') ? t2.features : {}
      if (updates.modes.orders !== undefined) feats.orders = !!updates.modes.orders
      if (updates.modes.appointments !== undefined) feats.appointments = !!updates.modes.appointments
      if (updates.modes.reservations !== undefined) feats.reservations = !!updates.modes.reservations
      dataUpdate.features = feats
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: dataUpdate,
    })
    return merged
  }

  private async updateMemory(tenantId: string, sessionKey: string, conv: Conversation) {
    try {
      if (!this.aiApiKey || !tenantId || !sessionKey) return
      if (!conv?.messages || conv.messages.length < 6) return
      if (conv.messages.length % 4 !== 0) return
      const transcript = conv.messages.slice(-24).map(m => `${m.role === 'user' ? 'Müşteri' : 'Asistan'}: ${String(m.content || '').slice(0, 300)}`).join('\n').slice(0, 4000)
      const raw = await this.rawAI([
        { role: 'system', content: 'Asagidaki musteri konusmasini Turkce, en fazla 2 cumle ve en fazla 30 kelime ile ozetle. Sadece musteri hakkinda kalici bilgileri yaz (ad, tercih, talep, sikayet, hangi konulari konustugu). Baska yazi ekleme.' },
        { role: 'user', content: transcript },
      ], 200)
      const summary = this.stripMarkup(String(raw || '')).trim().slice(0, 500)
      if (!summary) return
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { webchatConfig: true } })
      const cfg: any = (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object') ? { ...tenant.webchatConfig } : {}
      const memories: any = (cfg.memories && typeof cfg.memories === 'object') ? { ...cfg.memories } : {}
      memories[sessionKey] = { summary, at: new Date().toISOString() }
      const keys = Object.keys(memories)
      if (keys.length > 200) {
        keys.sort((a, b) => new Date(memories[a]?.at || 0).getTime() - new Date(memories[b]?.at || 0).getTime())
        for (const k of keys.slice(0, keys.length - 200)) delete memories[k]
      }
      cfg.memories = memories
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { webchatConfig: cfg as any } })
    } catch {}
  }

  async resetConfig(tenantId: string): Promise<ChatBotConfig> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { webchatConfig: {} as any },
    })
    this.pendingOrders.clear()
    this.pendingCustomers.clear()
    this.pendingAppts.clear()
    this.conversations.clear()
    return this.getConfig(tenantId)
  }

  private isUnknownResponse(response: string): boolean {
    if (!response) return false
    const t = response.toLowerCase()
    return [
      'bilmiyorum', 'bilgi sahibi değilim', 'bilgim yok', 'bu konuda bilgi',
      'emin değilim', 'yardımcı olamıyorum', 'cevap veremiyorum',
      'bilgi bulunmuyor', 'bilgilerimde yok', 'kayıtlı bilgi',
    ].some(w => t.includes(w))
  }

  private async recordUnknownQuestion(tenantId: string, question: string, platform = 'webchat', context?: string) {
    try {
      const q = String(question || '').trim().slice(0, 300)
      if (q.length < 6) return
      const ctx = context ? String(context).slice(0, 800) : undefined
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { webchatConfig: true } })
      const cfg: any = (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object') ? tenant.webchatConfig : {}
      const list: UnknownQuestion[] = Array.isArray(cfg.unknownQuestions) ? [...cfg.unknownQuestions] : []
      const norm = q.toLowerCase()
      const existing = list.find(x => !x.answered && String(x.question || '').toLowerCase().trim() === norm)
      if (existing) {
        existing.count = (existing.count || 1) + 1
        if (!existing.context && ctx) existing.context = ctx
      } else {
        list.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          question: q,
          platform,
          count: 1,
          answered: false,
          context: ctx,
          createdAt: new Date().toISOString(),
        })
      }
      const trimmed = list.slice(-150)
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { webchatConfig: { ...cfg, unknownQuestions: trimmed } as any },
      })
    } catch (e: any) {
      this.logger.warn('Bilinmeyen soru kaydedilemedi: ' + (e?.message || ''))
    }
  }

  private maybeRecordUnknown(tenantId: string | null | undefined, question: string, response: string, platform = 'webchat', explicit = false, context?: string) {
    if (!tenantId || (!response && !explicit)) return
    if (!explicit && !this.isUnknownResponse(response)) return
    this.recordUnknownQuestion(tenantId, question, platform, context).catch(() => {})
  }

  private stripUnknownFlag(text: string): { text: string; unknown: boolean } {
    const raw = String(text || '')
    const unknown = /\[BILMIYORUM\]/i.test(raw)
    return {
      text: raw.replace(/\[BILMIYORUM\]/gi, '').replace(/\n{3,}/g, '\n\n').trim(),
      unknown,
    }
  }

  async getUnknownQuestions(tenantId: string): Promise<UnknownQuestion[]> {
    if (!tenantId) return []
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { webchatConfig: true } })
    const cfg: any = (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object') ? tenant.webchatConfig : {}
    const list: UnknownQuestion[] = Array.isArray(cfg.unknownQuestions) ? cfg.unknownQuestions : []
    return list
      .filter(x => !x.answered)
      .sort((a, b) => (b.count || 1) - (a.count || 1) || +new Date(b.createdAt) - +new Date(a.createdAt))
  }

  async answerUnknownQuestion(tenantId: string, id: string, answer: string): Promise<{ success: boolean; config?: ChatBotConfig }> {
    const ans = String(answer || '').trim()
    if (!tenantId || !id || !ans) return { success: false }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { webchatConfig: true } })
    const cfg: any = (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object') ? tenant.webchatConfig : {}
    const list: UnknownQuestion[] = Array.isArray(cfg.unknownQuestions) ? [...cfg.unknownQuestions] : []
    const item = list.find(x => x.id === id)
    if (!item) return { success: false }

    item.answer = ans
    item.answered = true
    item.answeredAt = new Date().toISOString()

    const kbLine = `S: ${item.question}\nC: ${ans}`
    const kb = String(cfg.knowledgeBase || '')
    const newKb = kb.includes(kbLine) ? kb : (kb.trim() ? kb.trimEnd() + '\n\n' + kbLine : kbLine)
    const faqs = Array.isArray(cfg.faqs) ? [...cfg.faqs] : []
    if (!faqs.some((f: any) => String(f?.question || '').toLowerCase().trim() === String(item.question).toLowerCase().trim())) {
      faqs.push({ question: item.question, answer: ans })
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { webchatConfig: { ...cfg, knowledgeBase: newKb, faqs, unknownQuestions: list } as any },
    })
    return { success: true, config: await this.getConfig(tenantId) }
  }

  async dismissUnknownQuestion(tenantId: string, id: string): Promise<{ success: boolean }> {
    if (!tenantId || !id) return { success: false }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { webchatConfig: true } })
    const cfg: any = (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object') ? tenant.webchatConfig : {}
    const list: UnknownQuestion[] = Array.isArray(cfg.unknownQuestions) ? [...cfg.unknownQuestions] : []
    const item = list.find(x => x.id === id)
    if (!item) return { success: false }
    item.answered = true
    item.dismissed = true
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { webchatConfig: { ...cfg, unknownQuestions: list } as any } })
    return { success: true }
  }

  async trainChat(tenantId: string, history: { role: string; content: string }[]): Promise<{ reply: string; config: ChatBotConfig; applied: string[] }> {
    const current = await this.getConfig(tenantId)
    const { unknownQuestions, ...currentForAI } = current as any
    const msgs: Message[] = [
      { role: 'system', content: TRAIN_SYSTEM + '\n' + JSON.stringify(currentForAI) },
    ]
    const isPlatform = (current.businessName || '').toLowerCase() === 'bruskapp'
    const clean = (history || [])
      .slice(-24)
      .filter(m => !(m.role === 'assistant' && !isPlatform && this.isStalePlatformMessage(String(m.content || ''))))
      .map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as Message['role'],
        content: String(m.content || '').slice(0, 4000),
      }))
    msgs.push(...clean)

    const raw = await this.rawAI(msgs, 1800)
    if (!raw) {
      return { reply: 'Su an yapay zeka baglantisina ulasilamadi. Lutfen birkac saniye sonra tekrar deneyin.', config: current, applied: [] }
    }

    const { reply, patch } = this.extractConfigBlock(raw)
    const cleanReply = this.stripMarkup(reply)
    const applied = Object.keys(patch)
    let config = current
    if (applied.length > 0) {
      config = await this.updateConfig(tenantId, patch)
    }
    return { reply: cleanReply, config, applied }
  }

  private extractConfigBlock(text: string): { reply: string; patch: Partial<ChatBotConfig> } {
    let reply = String(text || '')
    const patch: any = {}
    const m = reply.match(/\[CONFIG\]([\s\S]*?)\[\/CONFIG\]/i)
    if (m) {
      reply = reply.replace(m[0], '')
      try {
        const parsed = JSON.parse(m[1].trim())
        const allowed = ['businessName', 'description', 'address', 'phone', 'hours', 'email', 'welcomeMessage', 'products', 'services', 'orderSettings', 'appointmentSettings', 'faqs', 'systemPrompt', 'knowledgeBase', 'modes', 'feedSettings']
        for (const k of allowed) {
          const v = parsed?.[k]
          if (v === undefined || v === null) continue
          if (typeof v === 'string' && v.trim() === '') continue
          patch[k] = v
        }
      } catch {
        this.logger.warn('trainChat: CONFIG blogu ayristirilamadi')
      }
    }
    reply = reply.replace(/```/g, '').replace(/\n{3,}/g, '\n\n').trim()
    return { reply, patch }
  }

  private async rawAI(messages: Message[], maxTokens = 1600): Promise<string | null> {
    if (!this.aiApiKey) return null
    try {
      const body = JSON.stringify({
        model: this.aiModel,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
      })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT)
      const res = await fetch(this.aiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.aiApiKey}` },
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) return null
      const data = await res.json()
      return data.choices?.[0]?.message?.content || null
    } catch (e: any) {
      this.logger.error(`rawAI hatasi: ${e?.message || 'bilinmeyen hata'}`)
      return null
    }
  }

  private parseItems(message: string, products: any[]): { name: string; quantity: number }[] {
    const lower = String(message || '').toLowerCase()
    const items: { name: string; quantity: number }[] = []
    for (const p of (products || [])) {
      const name = String(p?.name || '').toLowerCase().trim()
      if (!name) continue
      if (lower.includes(name)) {
        const idx = lower.indexOf(name)
        const before = lower.slice(Math.max(0, idx - 15), idx)
        const m = before.match(/(\d+)\s*(?:adet|tane|porsiyon|kg|gram)?\s*$/)
        items.push({ name: p.name, quantity: m ? (parseInt(m[1]) || 1) : 1 })
      }
    }
    if (items.length) return items
    const filler = /\b(istiyorum|istiyor|alabilirmiyim|alabilirmi|alabilir|alacağım|alacagim|lütfen|lutfen|adet|tane|sipariş|siparis|siparişi|siparisi|almak|verir|verebilir|olsun|onaylıyorum|onayliyorum|tamam|ad|bir)\b/gi
    const segs = String(message || '').split(/,|\bve\b|\n|\+|\d+\s*(?:adet|tane|porsiyon|kg|gram)\s+(?:daha)?/i).map(s => s.trim()).filter(Boolean)
    const out: { name: string; quantity: number }[] = []
    for (const seg of segs) {
      const q = seg.match(/(\d+)/)
      const nm = seg.replace(/\d+/g, ' ').replace(filler, ' ').replace(/\s+/g, ' ').trim()
      if (nm && nm.length >= 2) out.push({ name: nm, quantity: q ? (parseInt(q[1]) || 1) : 1 })
    }
    return out
  }

  private parseApptBlock(text: string): { name?: string; phone?: string; service?: string; date?: string; time?: string; note?: string } | null {
    const raw = String(text || '')
    const m = raw.match(/\[(?:RANDEVU|APPOINTMENT)\]([\s\S]*?)\[\/(?:RANDEVU|APPOINTMENT)\]/i)
    if (!m) return null
    const out: any = {}
    for (const line of m[1].split('\n')) {
      const t = line.replace(/^[\s\-•*>]+/, '').trim()
      if (!t) continue
      const kv = t.split(/[:=]/)
      if (kv.length < 2) continue
      const key = kv[0].trim().toLowerCase()
      const val = kv.slice(1).join(':').trim()
      if (!val) continue
      if (/^(ad|isim|ad soyad|adsoyad|musteri|müşteri)$/.test(key)) out.name = val
      else if (/^(telefon|tel|numara|phone)$/.test(key)) out.phone = val
      else if (/^(hizmet|servis|service|islem|işlem)$/.test(key)) out.service = val
      else if (/^(tarih|gun|gün|date)$/.test(key)) out.date = val
      else if (/^(saat|time)$/.test(key)) out.time = val
      else if (/^(not|notlar|note)$/.test(key)) out.note = val
    }
    return Object.keys(out).length ? out : null
  }

  private stripApptBlock(text: string): string {
    return String(text || '').replace(/\[(?:RANDEVU|APPOINTMENT)\][\s\S]*?\[\/(?:RANDEVU|APPOINTMENT)\]/gi, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim()
  }

  private parseTrDate(s: string | undefined): Date | null {
    if (!s) return null
    const months: Record<string, number> = { ocak: 0, şubat: 1, subat: 1, mart: 2, nisan: 3, mayıs: 4, mayis: 4, haziran: 5, temmuz: 6, ağustos: 7, agustos: 7, eylül: 8, eylul: 8, ekim: 9, kasım: 10, kasim: 10, aralık: 11, aralik: 11 }
    const t = String(s).toLowerCase().trim()
    let m = t.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/)
    if (m) { let y = parseInt(m[3]); if (y < 100) y += 2000; return new Date(y, parseInt(m[2]) - 1, parseInt(m[1])) }
    m = t.match(/(\d{1,2})\s+([a-zçğıöşü]+)/)
    if (m && months[m[2]] !== undefined) { const y = new Date().getFullYear(); return new Date(y, months[m[2]], parseInt(m[1])) }
    return null
  }

  private parseOrderBlock(text: string): { name: string; quantity: number }[] {
    const raw = String(text || '')
    const m = raw.match(/\[(?:SIPARIS|SIPARIŞ|ORDER)\]([\s\S]*?)\[\/(?:SIPARIS|SIPARIŞ|ORDER)\]/i)
    if (!m) return []
    const out: { name: string; quantity: number }[] = []
    for (const line of m[1].split('\n')) {
      const t = line.replace(/^[\s\-•*>]+/, '').trim()
      if (!t) continue
      const q = t.match(/^(\d+)\s*(?:x|×|\*|adet|tane|porsiyon)?\s*(.+)$/i)
      if (q && q[2].trim()) out.push({ name: q[2].trim(), quantity: parseInt(q[1]) || 1 })
    }
    return out
  }

  private stripOrderBlock(text: string): string {
    return String(text || '')
      .replace(/\[(?:SIPARIS|SIPARIŞ|ORDER)\][\s\S]*?\[\/(?:SIPARIS|SIPARIŞ|ORDER)\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim()
  }

  private parseCustomerBlock(text: string): Record<string, string> {
    const raw = String(text || '')
    const m = raw.match(/\[MUSTERI\]([\s\S]*?)\[\/MUSTERI\]/i)
    if (!m) return {}
    const out: Record<string, string> = {}
    for (const line of m[1].split('\n')) {
      const mm = line.match(/^\s*(ad|isim|telefon|adres|konum|not|notlar)\s*:\s*(.+?)\s*$/i)
      if (!mm) continue
      const key = mm[1].toLowerCase()
      const val = mm[2].trim()
      if (!val) continue
      const k = (key === 'isim' ? 'ad' : key === 'notlar' ? 'not' : key)
      out[k] = val
    }
    return out
  }

  private stripCustomerBlock(text: string): string {
    return String(text || '')
      .replace(/\[MUSTERI\][\s\S]*?\[\/MUSTERI\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim()
  }

  private mergeCustomerInfo(sessionKey: string, patch: Record<string, string>): Record<string, string> {
    if (!patch || !Object.keys(patch).length) return this.pendingCustomers.get(sessionKey) || {}
    const merged = { ...(this.pendingCustomers.get(sessionKey) || {}), ...patch }
    this.pendingCustomers.set(sessionKey, merged)
    return merged
  }

  private missingOrderFields(os: any, info: Record<string, string>): string[] {
    const missing: string[] = []
    const has = (v?: string) => !!v && v.trim().length > 0
    if (os?.requireName && !has(info.ad)) missing.push('Ad Soyad')
    if (os?.requirePhone && !has(info.telefon)) missing.push('Telefon')
    if (os?.requireAddress && !has(info.adres)) missing.push('Adres')
    if (os?.requireLocation && !has(info.konum)) missing.push('Konum')
    if (os?.requireNote && !has(info.not)) missing.push('Sipariş notu')
    return missing
  }

  private orderNoteFromInfo(info: Record<string, string>): string {
    return [
      info.adres ? 'Adres: ' + info.adres : '',
      info.konum ? 'Konum: ' + info.konum : '',
      info.not ? 'Not: ' + info.not : '',
    ].filter(Boolean).join(' | ')
  }

  private parseOrderLines(text: string): { name: string; quantity: number }[] {
    const out: { name: string; quantity: number }[] = []
    for (const line of String(text || '').split('\n')) {
      const t = line.replace(/^[^0-9A-Za-zÇĞİÖŞÜçğıöşü]+/, '').trim()
      const m = t.match(/^(\d+)\s*(?:x|×|\*)\s*(.+)$/i)
      if (m) {
        const name = m[2].replace(/https?:\/\/\S+/g, '').replace(/[✅✔*]/g, '').replace(/\s*[-–:].*$/, '').trim()
        if (name) out.push({ name, quantity: parseInt(m[1]) || 1 })
      }
    }
    return out
  }

  private isApprovalMessage(text: string): boolean {
    const t = String(text || '').toLowerCase().trim()
    if (!t) return false
    if (/(onayl|onay\s*ver|onayla|kabul ed|kabul|tasdik|approve|confirm)/i.test(t)) return true
    if (/^(evet|tamam|olur|aynen|doğru|dogru|uygun|ok|peki)[.!]?$/i.test(t)) return true
    return false
  }

  async getOrCreateConversation(sessionKey: string, tenantId?: string, from?: string): Promise<Conversation> {
    let conv = this.conversations.get(sessionKey)
    if (!conv) {
      conv = { messages: [], lastActivity: Date.now() }
      try {
        let tid = tenantId
        if (!tid) {
          const slug = sessionKey.split(':')[0]
          const tenant = await this.prisma.tenant.findFirst({ where: { slug }, select: { id: true } })
          if (tenant) tid = tenant.id
        }
        if (tid) {
          const tenantCfg = await this.prisma.tenant.findUnique({ where: { id: tid }, select: { webchatConfig: true } })
          const bizName = String((tenantCfg?.webchatConfig as any)?.businessName || '').toLowerCase()
          const isPlatform = bizName === 'bruskapp'
          const dbMsgs = await this.prisma.message.findMany({
            where: { tenantId: tid, from: from || sessionKey },
            orderBy: { createdAt: 'asc' },
            take: 20,
          })
          for (const msg of dbMsgs) {
            const isAssistant = msg.direction !== 'incoming'
            if (isAssistant && !isPlatform && this.isStalePlatformMessage(msg.content)) continue
            conv.messages.push({
              role: isAssistant ? 'assistant' : 'user',
              content: msg.content,
            })
          }
        }
      } catch {}
      this.conversations.set(sessionKey, conv)
    }
    const now = Date.now()
    for (const [id, c] of this.conversations) {
      if (now - c.lastActivity > 3600000) this.conversations.delete(id)
    }
    return conv
  }

  private isGreetingOnly(text: string): boolean {
    const greetings = new Set([
      'merhaba', 'merhabalar', 'selam', 'selamlar', 'slm', 'hi', 'hey', 'hello',
      'gunaydin', 'günaydın', 'iyi gunler', 'iyi günler', 'iyi aksanlar', 'iyi akşamlar',
      'iyi geceler', 'nasilsin', 'nasılsın', 'nasilsiniz', 'nasılsınız', 'naber', 'hola',
    ])
    const lower = text.toLowerCase().trim()
    const tokens = lower
      .replace(/[.,!?;:…"'"']/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    if (tokens.length === 0) return false
    return tokens.every(t => greetings.has(t))
  }

  private checkSessionRate(key: string): boolean {
    const now = Date.now()
    const entry = this.sessionRateMap.get(key)
    if (!entry || now > entry.resetAt) {
      this.sessionRateMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
      return true
    }
    if (entry.count >= RATE_LIMIT_MAX) return false
    entry.count++
    return true
  }

  private checkGlobalRate(ip: string): boolean {
    const now = Date.now()
    const entry = this.ipRateMap.get(ip)
    if (!entry || now > entry.resetAt) {
      this.ipRateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
      return true
    }
    if (entry.count >= Math.ceil(RATE_LIMIT_MAX * 3)) return false
    entry.count++
    return true
  }

  private checkHarmful(output: string): boolean {
    return HARMFUL_PATTERNS.some(p => p.test(output))
  }

  private sanitizeInput(text: string): string {
    let clean = (text || '').slice(0, MAX_MSG_LENGTH)
    clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    clean = clean.replace(/\uFFFD/g, '')
    clean = clean.trim()
    return clean
  }

  async processMessage(sessionId: string, message: string, clientIp = ''): Promise<string> {
    if (!this.checkSessionRate(sessionId)) {
      return 'Çok fazla mesaj gönderdiniz. Lütfen biraz bekleyin.'
    }
    if (clientIp && !this.checkGlobalRate(clientIp)) {
      return 'Çok fazla talep algılandı. Lütfen daha sonra tekrar deneyin.'
    }
    const cleaned = this.sanitizeInput(message)
    if (!cleaned) {
      return 'Lütfen geçerli bir mesaj yazın.'
    }

    // Save incoming message to DB for SSE
    const tid = await this.resolveTenantId(sessionId).catch(() => null)

    // Check credit and AI toggle before responding (for per-conversation override support)
    if (tid) {
      const hasCredit = await this.checkCredit(tid, 'webchat', sessionId).catch(() => true)
      if (!hasCredit) {
        this.messagesService?.create({ platform: 'webchat', from: sessionId, content: cleaned, direction: 'incoming', tenantId: tid }).catch(() => {})
        return ''
      }
    }

    if (cleaned.length > 500) {
      const short = cleaned.slice(0, 500) + '... [devamı kesildi]'
      const conv = await this.getOrCreateConversation(sessionId, tid || undefined)
      conv.messages.push({ role: 'user', content: short })
      conv.lastActivity = Date.now()
      const rawResponse = await this.generateResponse(short, conv, sessionId, short)
      const uf = this.stripUnknownFlag(rawResponse)
      const response = this.stripCustomerBlock(this.stripOrderBlock(uf.text))
      conv.messages.push({ role: 'assistant', content: response })
      if (tid) {
        this.messagesService?.create({ platform: 'webchat', from: sessionId, content: cleaned, direction: 'incoming', tenantId: tid }).catch(() => {})
        this.messagesService?.create({ platform: 'webchat', from: sessionId, content: response, direction: 'outgoing', tenantId: tid }).catch(() => {})
      }
      await this.syncLead(sessionId, cleaned, response, conv, tid || undefined).catch(() => {})
      this.maybeRecordUnknown(tid, cleaned, response, 'webchat', uf.unknown, this.recentContext(conv))
      if (tid) this.updateMemory(tid, sessionId, conv).catch(() => {})
      await this.detectIntent(sessionId, cleaned, uf.text, conv).catch(() => {}); return response
    }
    const conv = await this.getOrCreateConversation(sessionId, tid || undefined)
    if (conv.messages.length >= MAX_CONV_MSGS * 2) {
      conv.messages.splice(0, 4)
    }
    conv.messages.push({ role: 'user', content: cleaned })
    conv.lastActivity = Date.now()
    const rawResponse = await this.generateResponse(cleaned, conv, sessionId, cleaned)
    const uf = this.stripUnknownFlag(rawResponse)
    const response = this.stripOrderBlock(uf.text)
    conv.messages.push({ role: 'assistant', content: response })
    if (tid) {
      this.messagesService?.create({ platform: 'webchat', from: sessionId, content: cleaned, direction: 'incoming', tenantId: tid }).catch(() => {})
      this.messagesService?.create({ platform: 'webchat', from: sessionId, content: response, direction: 'outgoing', tenantId: tid }).catch(() => {})
    }
    await this.syncLead(sessionId, cleaned, response, conv, tid || undefined).catch(() => {})
    this.maybeRecordUnknown(tid, cleaned, response, 'webchat', uf.unknown, this.recentContext(conv))
    if (tid) this.updateMemory(tid, sessionId, conv).catch(() => {})
    await this.detectIntent(sessionId, cleaned, uf.text, conv).catch(() => {}); return response
  }

  private async loadConfigForSlug(slug: string): Promise<ChatBotConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { webchatConfig: true, name: true },
    })
    if (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object' && Object.keys(tenant.webchatConfig as any).length > 0) {
      return this.normalizeConfig({ ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) })
    }
    return this.normalizeConfig(this.defaultConfig(tenant?.name))
  }

  private async getUserRecordsContext(tenantId?: string, sessionId?: string, conv?: Conversation): Promise<string | null> {
    try {
      let tid = tenantId
      if (!tid && sessionId) {
        const slug = sessionId.split(':')[0] || 'default'
        const t = await this.prisma.tenant.findFirst({ where: { slug }, select: { id: true } })
        if (t) tid = t.id
      }
      if (!tid) return null

      // Kullanici adini conversation'dan cikar
      const userMsgs = conv?.messages?.filter(m => m.role === 'user').map(m => m.content).join(' ') || ''
      const nameMatch = userMsgs.match(/(?:benim adım|adim|bana da|ben|bana|ismim) (.+?)(?:[,.]|\s|$)/i)
      const customerName = nameMatch ? nameMatch[1].trim() : null

      let ctx = '\nKULLANICI VERILERI (DB):\n'

      if (customerName) {
        // Aktif siparisler
        const orders = await this.prisma.order.findMany({ where: { tenantId: tid, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 3 })
        if (orders.length > 0) ctx += `- Aktif siparisleri: ${orders.map(o => `#${o.id} (${(o.products as any[])?.[0]?.name || 'urun'} - olusturuldu ${this.fmtDate(o.createdAt.toISOString())})`).join(', ')}\n`

        // Aktif randevular
        const appointments = await this.prisma.appointment.findMany({ where: { tenantId: tid, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 3 })
        if (appointments.length > 0) ctx += `- Aktif randevulari: ${appointments.map(a => `${a.service || 'Randevu'} (${this.fmtDate(new Date(a.date).toISOString())}${a.time ? ' ' + a.time : ''}, olusturuldu ${this.fmtDate(a.createdAt.toISOString())})`).join(', ')}\n`

        // Aktif rezervasyonlar
        const reservations = await this.prisma.reservation.findMany({ where: { tenantId: tid, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 3 })
        if (reservations.length > 0) ctx += `- Aktif rezervasyonlari: ${reservations.map(r => `${r.guests} kisilik (${this.fmtDate(new Date(r.date).toISOString())}${r.time ? ' ' + r.time : ''}, olusturuldu ${this.fmtDate(r.createdAt.toISOString())})`).join(', ')}\n`

        if (orders.length === 0 && appointments.length === 0 && reservations.length === 0) {
          ctx += '- Bu kullanicinin aktif siparis, randevu veya rezervasyonu bulunmamaktadir.\n'
        }
      } else {
        ctx += '- Kullanici adi henuz bilinmiyor. Kullanici adini ogrenmek icin "Adinizi ogrenebilir miyim?" diye sor.\n'
      }

      ctx += 'Yukaridaki verileri kullanarak kullaniciya dogru bilgi ver. Kullanicinin kaydi yoksa "aktif kaydiniz bulunmamaktadir" de.\n'
      return ctx
    } catch { return null }
  }

  private buildBaseSystem(config: ChatBotConfig): string {
    const c = config
    let prompt = `Sen ${c.businessName} işletmesinin yapay zeka asistanısın.\n`
    prompt += `Şu an: ${this.nowTr()} (Türkiye saati). "Bugün", "yarın", "dün", "ne zaman" gibi tarih/saat ifadelerini hep bu ana göre yorumla.\n`
    const bizInfo: string[] = []
    if (c.description) bizInfo.push(`İşletme: ${c.description}`)
    if (c.address) bizInfo.push(`Adres: ${c.address}`)
    if (c.email) bizInfo.push(`E-posta: ${c.email}`)
    if (c.phone) bizInfo.push(`Telefon: ${c.phone}`)
    if (c.hours) bizInfo.push(`Çalışma: ${c.hours}`)
    if (bizInfo.length) prompt += bizInfo.join(' | ') + '\n'
    if (c.welcomeMessage) prompt += `Karşılama: ${c.welcomeMessage}\n`
    prompt += `\nKurallar:\n`
    if ((c.businessName || '').toLowerCase() !== 'bruskapp') {
      prompt += `- SADECE ${c.businessName} isletmesi hakkinda konus. Baska markalardan veya platform ozelliklerinden (CRM, chatbot, sesli asistan, QR menu vb.) ASLA bahsetme.\n`
    }
    prompt += `- Turkce, kisa ve oz cevap ver.\n`
    prompt += `- ZORUNLU: Tum Turkce karakterleri dogru kullan.\n`
    prompt += `- ASAGIDAKI BILGI HAVUZUNU KULLAN. Kullanici sorusunu oku, bilgi havuzunda AYNI KONUYU bul, buldugun bilgiyi cevap olarak ver.\n`
    prompt += `- Bilgi havuzunda konuyla ilgili bilgi VARSA onu kullan, bilgi havuzundaki kural ve yonlendirmelere uygun cevap ver.\n`
    prompt += `- Bilgi havuzunda cevap yoksa KENDI profesyonel ve nazik tarzinla cevap ver, kisa ve yardimci ol. "Bu konuda su an bilgim yok" gibi kalip cevaplar KULLANMA.\n`
    prompt += `- ONEMLI: Bilgi havuzunda ve isletme ayarlarinda sorunun NET cevabi YOKSA, cevabinin EN SONUNA aynen [BILMIYORUM] etiketini ekle. Bu etiket musteriye gosterilmez; isletme sahibinin ogrenmesi icindir. Cevap VARSA bu etiketi ASLA ekleme.\n`
    prompt += `- KESINLIKLE kendi bilgini uydurma, bilgi havuzundaki bilgileri ve isletme ayarlarini kullan.\n`
    prompt += `- KESINLIKLE su tür genel cevaplari VERME: "Mesajiniz alindi", "En kisa surede donus yapilacaktir", "Iletilecektir", "Gerekli yonlendirme yapilacaktir".\n`
    prompt += `- KESINLIKLE isaretleme kullanma. Duzyazi yaz.\n`
    const modes: any = c.modes || {}
    const canOrder = modes.orders !== false
    const canAppt = modes.appointments !== false
    const canRes = modes.reservations !== false
    const caps: string[] = []
    if (canOrder) caps.push('SIPARIS alabilirsin')
    if (canAppt) caps.push('RANDEVU alabilirsin')
    if (canRes) caps.push('REZERVASYON alabilirsin')
    prompt += `- YETENEKLERIN: ${caps.length ? caps.join(', ') : 'soru-cevap yapabilirsin'}.\n`
    if (canOrder && c.products.length) {
      const avail = c.products.filter(p => !p.soldOut)
      const soldOut = c.products.filter(p => p.soldOut)
      prompt += `- URUNLER (sadece bunlari kullan):\n`
      for (const p of avail) {
        const u = p.unit ? ` (birim: ${p.unit})` : ''
        const op = (p.options && p.options.length) ? ` | secenekler: ${p.options.map(o => o.name + (o.price ? ' +' + o.price : '')).join(', ')}` : ''
        prompt += `  * ${p.name}: ${p.price}${u}${op}\n`
      }
      if (soldOut.length) {
        prompt += `- BITTI / STOKTA YOK (musteri isterse "maalesef su an yok" de, siparisi kabul ETME): ${soldOut.map(p => p.name).join(', ')}\n`
        prompt += `- Sadece yukaridaki "URUNLER" listesindeki urunleri sat. Bitti listesindekileri SATMA.\n`
      }
    }
    if (canOrder) {
      const os = c.orderSettings || {}
      const req: string[] = []
      if (os.requireName) req.push('Ad Soyad')
      if (os.requirePhone) req.push('Telefon')
      if (os.requireAddress) req.push('Adres (manuel)')
      if (os.requireLocation) req.push('Konum (WhatsApp konumu)')
      if (os.requireNote) req.push('Siparis notu')
      prompt += req.length
        ? `- SIPARIS ICIN ZORUNLU BILGILER: ${req.join(', ')}. Bunlar tamamlanmadan siparisi ONAYLAMA ve "olusturuldu" DEME.\n`
        : `- SIPARIS ICIN ZORUNLU BILGI YOK; sadece urun ve adet yeterli.\n`
    }
    if (canOrder) prompt += `- SIPARIS: Kullanici siparis vermek istediginde URUNU ve BIRIMI netlestir (kg/adet/gram/set/porsiyon), secenekleri sor; sonra tum siparisi MADDELER halinde ozetle ve "Onayliyor musunuz?" diye sor. Onay gelince "Siparisinizi aldim" de.\n`
    if (canOrder) prompt += `- SIPARIS MAKINE BLOGU: Siparisi ozetleyip listeledigin HER mesajda (onay isterken de, onay aldiktan sonra da), cevabinin EN SONUNA gizli blok ekle. Blok her zaman EN SONDA olsun. Her urun AYRI SATIRDA. Format AYNEN:\n[SIPARIS]\n2 x Urun Adi\n1 x Diger Urun\n[/SIPARIS]\nBlok icinde fiyat, aciklama veya baska yazi YAZMA. Urun adi kisa olsun.\n`
    if (canOrder) prompt += `- MUSTERI BILGILERI BLOGU: Musterinin paylastigi ad, telefon, adres, konum ve not bilgilerini cevabinin EN SONUNA gizli blok olarak ekle. Format AYNEN:\n[MUSTERI]\nad: ...\ntelefon: ...\nadres: ...\nkonum: ...\nnot: ...\n[/MUSTERI]\nSadece musteri paylastigi alanlari yaz, uydurma. Musteri WhatsApp/konum paylasirsa konum alanina linki veya koordinati yaz. Eksik zorunlu bilgi varsa once o bilgiyi iste.\n`
    if (canAppt) {
      if (c.services && c.services.length) {
        prompt += `- HIZMETLER (sadece bunlari kullan):\n`
        for (const s of c.services) {
          prompt += `  * ${s.name}${s.duration ? ' (' + s.duration + ')' : ''}${s.price ? ': ' + s.price : ''}\n`
        }
      }
      const as = (c.appointmentSettings as any) || {}
      const areq: string[] = []
      if (as.requireName) areq.push('Ad Soyad')
      if (as.requirePhone) areq.push('Telefon')
      if (as.requireService) areq.push('Hizmet')
      if (as.requireDate) areq.push('Tarih')
      if (as.requireTime) areq.push('Saat')
      if (as.requireNote) areq.push('Not')
      prompt += areq.length
        ? `- RANDEVU ICIN ZORUNLU BILGILER: ${areq.join(', ')}. Bunlar tamamlanmadan randevuyu ONAYLAMA.\n`
        : `- RANDEVU: Kullanici randevu istediginde HIZMETI ve TARIH/SAATI netlestir, ozetleyip onaylat.\n`
      prompt += `- RANDEVU MAKINE BLOGU: Randevu bilgilerini toplayip OZETLEYIP onay isterken, cevabinin EN SONUNA gizli blok ekle. Format AYNEN:\n[RANDEVU]\nad: Ahmet Yilmaz\ntelefon: 05xxxxxxxxx\nhizmet: Protez Tirnak\ntarih: 15.06.2026\nsaat: 14:00\nnot: \n[/RANDEVU]\n- Bir alan bilinmiyorsa o satiri bos birak. Fiyat/aciklama yazma.\n`
      prompt += `- RANDEVU GUNCELLEME: Musteri randevusunu ertelemek/tarih degistirmek isterse YENI tarih-saat al; bos/eksik tarihle degistirme. Iptal isterse once sebebini sor, sonra iptal et.\n`
    }
    if (canRes) prompt += `- REZERVASYON: Kullanici rezervasyon istediginde KISI SAYISI ve TARIH/SAATI netlestir, ozetleyip onaylat, sonra "Rezervasyonunuz olusturuldu" de.\n`
    prompt += `- İPTAL: Kullanici iptal istedigi once "Iptal sebebinizi ogrenebilir miyim?" diye sor. Sebebi alinca "Iptaliniz gerceklestirildi" de. Hangi randevu/siparis oldugunu anlamak icin tarih veya urun adi iste. Ornek: "Hangi tarihteki randevunuzu iptal etmek istiyorsunuz?"\n`
    if (c.systemPrompt) prompt += `- ${c.systemPrompt}\n`
    if (c.configUpdatedAt) prompt += `- İşletme bilgileri en son ${this.fmtDate(c.configUpdatedAt)} tarihinde güncellendi.\n`
    if (Array.isArray(c.changeLog) && c.changeLog.length) {
      prompt += `- Son güncellemeler:\n`
      for (const e of c.changeLog.slice(-5).reverse()) prompt += `  * ${this.fmtDate(e.at)}: ${e.note}\n`
    }
    if (c.knowledgeBase) {
      prompt += `\nBILGI HAVUZU:\n${c.knowledgeBase}\n`
    }
    return prompt
  }

  static parseButtons(text: string): { text: string; buttons: string[] } {
    const raw = String(text || '')
    const m = raw.match(/\[\[(?:butonlar[:\s]*)?([^\[\]]*\|[^\[\]]*)\]\]/i)
    if (!m) return { text: raw.trim(), buttons: [] }
    const buttons = m[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3)
    if (buttons.length < 2) return { text: raw.trim(), buttons: [] }
    const clean = raw.replace(m[0], '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '').trim()
    return { text: clean, buttons }
  }

  private buildContext(config: ChatBotConfig, message: string): string {
    const c = config
    const lower = message.toLowerCase().trim()
    const parts: string[] = []

    const matchedProducts = c.products.filter(p => {
      const name = (p.name || '').trim().toLowerCase()
      if (!name) return false
      return lower.includes(name) || lower.split(/\s+/).some((w: string) => w.length >= 3 && name.includes(w))
    })

    if (matchedProducts.length === 1) {
      const p = matchedProducts[0]
      parts.push(`Kullanici su urun hakkinda soruyor: ${p.name} - ${p.description} - ${p.price}`)
    } else if (matchedProducts.length > 1) {
      parts.push(`Kullanici su urunlerden bahsediyor:`)
      matchedProducts.forEach(p => parts.push(`- ${p.name}: ${p.description} (${p.price})`))
    } else if (this.hasAnyWord(lower, ['fiyat', 'urun', 'hizmet', 'cozum', 'paket', 'neler var', 'ne yapiyor'])) {
      if (c.products.length > 0) {
        parts.push(`Tum urunler:`)
        c.products.forEach(p => parts.push(`- ${p.name}: ${p.description} (${p.price})`))
      }
    }

    const matchedFaqs = c.faqs.filter(f => {
      const q = f.question.toLowerCase()
      const qWords = q.split(/\s+/).filter((w: string) => w.length > 2)
      return qWords.filter(w => lower.includes(w)).length >= Math.ceil(qWords.length * 0.5)
    })
    if (matchedFaqs.length > 0) {
      parts.push(`Ilgili SSS:`)
      matchedFaqs.forEach(f => parts.push(`S: ${f.question} / C: ${f.answer}`))
    }

    if (this.hasAnyWord(lower, ['adres', 'nerede', 'konum', 'telefon', 'iletisim', 'ulas', 'email', 'saat', 'mesai', 'calisma'])) {
      parts.push(`İletişim: ${c.email} | Adres: ${c.address} | Saatler: ${c.hours}`)
    }

    return parts.length > 0 ? parts.join('\n') : ''
  }

  private async callAI(messages: Message[], config: ChatBotConfig): Promise<string | null> {
    await new Promise(r => setTimeout(r, 50 + Math.random() * 50))
    if (!this.aiApiKey) return null

    try {
      const userMsg = messages.filter(m => m.role === 'user').pop()?.content || ''
      const baseSystem = this.buildBaseSystem(config)
      const context = this.buildContext(config, userMsg)

      const aiMessages: Message[] = [
        { role: 'system', content: baseSystem }
      ]

      if (context) {
        aiMessages.push({ role: 'system', content: 'SADECE şu bilgileri kullan. Kendi bilgini EKLEME, HİÇBİR ŞEY UYDURMA:\n' + context })
      }

      const history = messages.slice(-20)
      aiMessages.push(...history)

      const body = JSON.stringify({
        model: this.aiModel,
        messages: aiMessages,
        temperature: 0,
        max_tokens: 1750
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT)

      let res = await fetch(this.aiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.aiApiKey}`
        },
        body,
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const errStatus = res.status
        const errBody = await res.text()
        if (errStatus === 429 || errStatus === 500 || errStatus === 502 || errStatus === 503 || errStatus === 504) {
          await new Promise(r => setTimeout(r, 500))
          const controller2 = new AbortController()
          const timeout2 = setTimeout(() => controller2.abort(), AI_TIMEOUT)
          res = await fetch(this.aiBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.aiApiKey}` },
            body,
            signal: controller2.signal,
          })
          clearTimeout(timeout2)
          if (!res.ok) return null
        } else {
          return null
        }
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || null
      if (!content) return null

      const sanitized = this.sanitizeResponse(content)

      if (this.checkHarmful(sanitized)) {
        return 'Bu konuda size yardımcı olamıyorum. Başka bir sorunuz mu var?'
      }

      return sanitized
    } catch (e: any) {
      this.logger.error(`callAI hatasi: ${e?.message || 'bilinmeyen hata'}`)
      return null
    }
  }

  private stripMarkup(text: string): string {
    let clean = String(text || '')
    clean = clean.replace(/```[\s\S]*?```/g, '')
    clean = clean.replace(/\*\*(.+?)\*\*/g, '$1')
    clean = clean.replace(/__(.+?)__/g, '$1')
    clean = clean.replace(/~~(.+?)~~/g, '$1')
    clean = clean.replace(/`(.+?)`/g, '$1')
    clean = clean.replace(/#{1,6}\s/g, '')
    clean = clean.replace(/\*/g, '')
    clean = clean.replace(/^\s*[-+]\s+/gm, '• ')
    clean = clean.replace(/[ \t]+\n/g, '\n')
    clean = clean.replace(/\n{3,}/g, '\n\n')
    return clean.trim()
  }

  private sanitizeResponse(text: string): string {
    let clean = this.stripMarkup(text)
    clean = clean.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
    clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (m) => {
      const parts = m.split('@')
      if (parts[0].length > 2) {
        return parts[0][0] + '***@' + parts[1]
      }
      return m
    })
    clean = clean.replace(/\n{3,}/g, '\n\n')

    const turkishWords: Record<string, string> = {
      'yardimci': 'yardımcı', 'yardim': 'yardım',
      'calisma': 'çalışma', 'calis': 'çalış', 'calisiyor': 'çalışıyor',
      'urun': 'ürün', 'urunler': 'ürünler', 'urunumuz': 'ürünümüz', 'urunlerimiz': 'ürünlerimiz',
      'icin': 'için', 'cikti': 'çıktı', 'cikar': 'çıkar', 'cikis': 'çıkış',
      'egitim': 'eğitim', 'eglence': 'eğlence',
      'iletisim': 'iletişim', 'yonetim': 'yönetim', 'yonetimi': 'yönetimi',
      'entegrasyon': 'entegrasyon',
      'siparis': 'sipariş', 'odeme': 'ödeme', 'odemeler': 'ödemeler',
      'cozum': 'çözüm', 'cozumler': 'çözümler', 'cozumlerimiz': 'çözümlerimiz',
      'hizmet': 'hizmet', 'musteri': 'müşteri', 'musteriler': 'müşteriler',
      'kullanici': 'kullanıcı', 'kullanicilar': 'kullanıcılar',
      'ozel': 'özel', 'ozellik': 'özellik', 'ozellikle': 'özellikle',
      'icerik': 'içerik', 'isletme': 'işletme', 'isletmeniz': 'işletmeniz',
      'karsilama': 'karşılama',
      'turkce': 'türkçe', 'turkiye': 'türkiye',
      'sormus': 'sormuş', 'yapmis': 'yapmış', 'demis': 'demiş',
      'almis': 'almış', 'vermis': 'vermiş', 'gelmis': 'gelmiş',
      'baska': 'başka', 'nasil': 'nasıl',
      'goruntu': 'görüntü', 'dogru': 'doğru', 'goster': 'göster',
      'basla': 'başla', 'basliyor': 'başlıyor', 'baslangic': 'başlangıç',
      'sanal': 'sanal', 'sef': 'şef',
    }
    for (const [wrong, correct] of Object.entries(turkishWords)) {
      const regex = new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      clean = clean.replace(regex, correct)
    }

    clean = clean.trim()
    return clean
  }

  async generatePlatformResponse(tenantId: string, platform: string, userId: string, message: string, fromName?: string): Promise<string | null> {
    const sessionKey = `${platform}:${tenantId}:${userId}`

    if (!this.checkSessionRate(sessionKey)) {
      return null
    }

    const cleaned = this.sanitizeInput(message)
    if (!cleaned) {
      return null
    }

    // Saf selamlama mesajlarinda AI'a gitmeden isletmenin kendi karsilama mesajini gonder
    if (this.isGreetingOnly(cleaned)) {
      try {
        const config = await this.getConfig(tenantId)
        if (config.welcomeMessage) return config.welcomeMessage
      } catch {}
    }

    if (cleaned.length > 500) {
      const short = cleaned.slice(0, 500) + '... [devamı kesildi]'
      const hasCredit = await this.checkCredit(tenantId, platform, userId)
      if (!hasCredit) return null
      const conv = await this.getOrCreateConversation(sessionKey, tenantId, userId)
      conv.messages.push({ role: 'user', content: short })
      conv.lastActivity = Date.now()
      const rawResponse = await this.generateResponse(short, conv, sessionKey, short, tenantId)
      const uf = this.stripUnknownFlag(rawResponse || '')
      const response = this.stripCustomerBlock(this.stripOrderBlock(uf.text)) || null
      if (response) conv.messages.push({ role: 'assistant', content: response })
      this.maybeRecordUnknown(tenantId, cleaned, response || '', platform, uf.unknown, this.recentContext(conv))
      this.updateMemory(tenantId, sessionKey, conv).catch(() => {})
      return response
    }

    const hasCredit = await this.checkCredit(tenantId, platform, userId)
    if (!hasCredit) return null

    const conv = await this.getOrCreateConversation(sessionKey, tenantId, userId)
    if (conv.messages.length >= MAX_CONV_MSGS * 2) {
      conv.messages.splice(0, 4)
    }

    const lastMsg = conv.messages[conv.messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'user' || this.sanitizeInput(lastMsg.content) !== cleaned) {
      conv.messages.push({ role: 'user', content: cleaned })
    }
    conv.lastActivity = Date.now()
    // Fetch campaigns for AI context
    let campaignContext = ''
    try {
      const campaigns = await this.prisma.campaign.findMany({ where: { tenantId, status: 'active' } })
      if (campaigns.length > 0) {
        campaignContext = '\nAKTIF KAMPANYALAR:\n'
        for (const camp of campaigns) {
          campaignContext += '- ' + camp.title + (camp.description ? ': ' + camp.description : '') + (camp.discount ? ' (%' + camp.discount + ' indirim)' : '') + '\n'
        }
      }
    } catch {}
    const enhanced = campaignContext ? cleaned + '\n\n[KAMPANYA BILGISI:\n' + campaignContext + ']' : cleaned
    const rawResponse = await this.generateResponse(enhanced, conv, sessionKey, enhanced, tenantId)
    if (!rawResponse) return null
    const uf = this.stripUnknownFlag(rawResponse)
    const blockNow = this.parseOrderBlock(uf.text)
    const linesNow = blockNow.length ? blockNow : this.parseOrderLines(uf.text)
    let response = blockNow.length ? this.stripOrderBlock(uf.text) : uf.text
    response = this.stripCustomerBlock(response)
    if (linesNow.length) this.pendingOrders.set(sessionKey, linesNow)
    this.mergeCustomerInfo(sessionKey, this.parseCustomerBlock(uf.text))
    conv.messages.push({ role: 'assistant', content: response })
    // Multi-channel lead creation
    try {
      const existingLead = await this.prisma.lead.findFirst({ where: { sessionId: sessionKey }, orderBy: { createdAt: 'desc' } })
      const uc = await this.getOrCreateConversation(sessionKey, tenantId, userId)
      const ucMsgs = uc.messages.map(m => ({ role: m.role, content: m.content }))
      const needs = ucMsgs.map(m => m.content).join(' | ').slice(0, 500)
      const leadName = fromName || userId || platform + ' Kullanıcısı'
      if (existingLead) {
        await this.prisma.lead.update({ where: { id: existingLead.id }, data: { name: leadName, needs, conversation: ucMsgs.slice(-30) } })
      } else {
        await this.prisma.lead.create({
          data: { sessionId: sessionKey, name: leadName, needs, conversation: ucMsgs.slice(-30), source: platform, tenantId }
        })
      }
    } catch {}
    // Intent detection for platform messages
    try {
      const featureTenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { features: true } })
      const features = (featureTenant?.features as any) || {}
      const pConv = await this.getOrCreateConversation(sessionKey, tenantId, userId)
      const allMsgs = pConv.messages.filter(m => m.role === 'user').map(m => m.content).join(' ').toLowerCase()
      const approve = this.isApprovalMessage(cleaned)
      const pending = this.pendingOrders.get(sessionKey) || []
      if (features.orders !== false && approve && pending.length) {
        const cfgOrder = await this.getConfig(tenantId).catch(() => null as any)
        const os = (cfgOrder && cfgOrder.orderSettings) || {}
        const info = this.pendingCustomers.get(sessionKey) || {}
        const missing = this.missingOrderFields(os, info)
        if (missing.length) {
          response = `Siparişinizi tamamlayabilmemiz için şu bilgiyi de paylaşır mısınız: ${missing.join(', ')}?`
          return response
        }
        this.pendingOrders.delete(sessionKey)
        this.pendingCustomers.delete(sessionKey)
        if (this.ordersService) this.ordersService.create({ tenantId, platform, customerName: info.ad || userId || platform + ' Kullanıcısı', products: pending, totalAmount: 0, note: this.orderNoteFromInfo(info) }).catch(() => {})
      }
      if (features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('muayene'))) {
        if (this.appointmentsService) this.appointmentsService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', date: new Date(Date.now() + 86400000).toISOString(), time: '10:00' }).catch(() => {})
      }
      if (features.reservations !== false && (allMsgs.includes('masa') || allMsgs.includes('rezervasyon') || allMsgs.includes('yer ayırt'))) {
        if (this.reservationsService) this.reservationsService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', date: new Date(Date.now() + 86400000).toISOString(), time: '20:00', guests: 2 }).catch(() => {})
      }
    } catch {}
    this.maybeRecordUnknown(tenantId, cleaned, response, platform, uf.unknown, this.recentContext(conv))
    this.updateMemory(tenantId, sessionKey, conv).catch(() => {})
    return response
  }

  async generateResponse(message: string, conv?: Conversation, sessionId = '', cleaned = '', tenantId?: string): Promise<string> {
    let config: ChatBotConfig
    if (tenantId) {
      config = await this.getConfig(tenantId)
    } else {
      const slug = sessionId?.split(':')[0] || 'default'
      config = await this.loadConfigForSlug(slug)
    }

    if (!conv) {
      conv = { messages: [], lastActivity: Date.now() }
      conv.messages.push({ role: 'user', content: message })
    }
    const lower = message.toLowerCase().trim()

    // Kullanicinin aktif kayitlarini DB'den getir ve AI context'ine ekle
    const userContext = await this.getUserRecordsContext(tenantId, sessionId, conv).catch(() => null)
    if (userContext) {
      config = { ...config, systemPrompt: (config.systemPrompt || '') + '\n' + userContext }
    }

    // Uzun sureli musteri hafizasi (onceki konusmalardan ozet)
    if (tenantId && sessionId && config.memories && config.memories[sessionId]?.summary) {
      config = { ...config, systemPrompt: (config.systemPrompt || '') + '\nMÜŞTERİ HAFIZASI (önceki konuşmalardan): ' + config.memories[sessionId].summary }
    }

    const aiResponse = await this.callAI(conv.messages, config)
    if (aiResponse) return aiResponse

    const faq = config.faqs.find(f => f.question.toLowerCase().trim() === lower)
    if (faq) return faq.answer

    return ''
  }

  private async detectIntent(sessionId: string, message: string, aiResponse: string, conv: Conversation) {
    try {
      const slug = sessionId?.split(':')[0] || 'default'
      const tenant = await this.prisma.tenant.findFirst({ where: { slug }, select: { id: true, features: true } })
      if (!tenant?.id) return
      const features = (tenant.features as any) || {}

      // AI yanıtında "yönetici" geçiyorsa hiçbir işlem yapma
      const lowerResp = aiResponse.toLowerCase()
      if (lowerResp.includes('yönetici') || lowerResp.includes('yonetici') || lowerResp.includes('ilet') || lowerResp.includes('bilgim yok')) return

      const allMsgs = conv.messages.filter(m => m.role === 'user').map(m => m.content).join(' ').toLowerCase()
      const lower = message.toLowerCase()

      const phoneMatch = message.match(/(0[0-9]{10}|05[0-9]{9}|\+90[0-9]{10}|5[0-9]{9})/g)
      const nameMatch = message.match(/(?:benim adım|adim|bana da|ben|bana|ismim) (.+?)(?:[,.]|\s|$)/i)
      const customerName = nameMatch ? nameMatch[1].trim() : 'Web Chat Ziyaretçisi'
      const customerContact = phoneMatch ? phoneMatch[0] : ''

      // İptal tespiti (AI onayladıysa)
      if ((allMsgs.includes('iptal') || allMsgs.includes('cancel') || allMsgs.includes('vazgeç') || allMsgs.includes('vazgectim')) && (lowerResp.includes('iptal') || lowerResp.includes('edildi'))) {
        const reason = message.replace(/(?:iptal|cancel|vazgeç|vazgectim|etmek|ediyorum|istiyorum|oldu|ettim)/gi, '').trim().slice(0, 200) || 'Müşteri tarafından iptal edildi'
        const note = 'İptal sebebi: ' + reason
        if (features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis') || allMsgs.includes('siparişimi') || allMsgs.includes('siparisimi'))) {
          const latest = await this.prisma.order.findFirst({ where: { tenantId: tenant.id, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) await this.prisma.order.update({ where: { id: latest.id }, data: { status: 'cancelled', note } }).catch(() => {})
        }
        if (features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('randevumu') || allMsgs.includes('randevuyu'))) {
          const latest = await this.prisma.appointment.findFirst({ where: { tenantId: tenant.id, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) await this.prisma.appointment.update({ where: { id: latest.id }, data: { status: 'cancelled', notes: note } }).catch(() => {})
        }
        if (features.reservations !== false && (allMsgs.includes('rezervasyon') || allMsgs.includes('rezervasyonu') || allMsgs.includes('masayı') || allMsgs.includes('masa'))) {
          const latest = await this.prisma.reservation.findFirst({ where: { tenantId: tenant.id, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) await this.prisma.reservation.update({ where: { id: latest.id }, data: { status: 'cancelled', notes: note } }).catch(() => {})
        }
        return
      }

      // Sipariş tespiti (müşteri onayı + makine blok)
      const blockI = this.parseOrderBlock(aiResponse)
      const linesI = blockI.length ? blockI : this.parseOrderLines(aiResponse)
      if (linesI.length) this.pendingOrders.set(sessionId, linesI)
      this.mergeCustomerInfo(sessionId, this.parseCustomerBlock(aiResponse))
      const pendingI = this.pendingOrders.get(sessionId) || []
      if (features.orders !== false && this.isApprovalMessage(message) && pendingI.length) {
        const cfgO = await this.getConfig(tenant.id).catch(() => null as any)
        const osO = (cfgO && cfgO.orderSettings) || {}
        const infoO = this.pendingCustomers.get(sessionId) || {}
        const missingO = this.missingOrderFields(osO, infoO)
        if (!missingO.length) {
          this.pendingOrders.delete(sessionId)
          this.pendingCustomers.delete(sessionId)
          if (this.ordersService) {
            await this.ordersService.create({
              tenantId: tenant.id,
              platform: 'webchat',
              customerName: infoO.ad || customerName,
              customerContact: infoO.telefon || customerContact,
              products: pendingI,
              totalAmount: 0,
              note: this.orderNoteFromInfo(infoO),
            }).catch(() => {})
          }
        }
      }

      // Randevu: yapısal blok + onay akışı
      if (features.appointments !== false) {
        const ap = this.parseApptBlock(aiResponse)
        if (ap) {
          const st = { ...(this.pendingAppts.get(sessionId) || {}), ...ap }
          this.pendingAppts.set(sessionId, st)
        }
        const pend = this.pendingAppts.get(sessionId) || {}

        // Güncelleme (tarih değiştir / ertele)
        const wantsUpdate = /(ertele|tarih(i|ini)?\s*(degis|değiş)|gun(u|ünü)?\s*(degis|değiş)|randevu.*guncelle|randevu.*güncelle)/i.test(message)
        if (wantsUpdate && this.appointmentsService) {
          const newDate = this.parseTrDate((message.match(/(\d{1,2})[.\/\-]\d{1,2}[.\/\-]\d{2,4}|\d{1,2}\s+[a-zçğıöşü]+/i) || [])[0]) || this.parseTrDate(pend.date)
          const newTime = (message.match(/(\d{1,2})[.:](\d{2})/) || [])[0] || pend.time
          if (newDate) {
            const latest = await this.prisma.appointment.findFirst({ where: { tenantId: tenant.id, customerContact: customerContact || undefined, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
            if (latest && this.appointmentsService.update) {
              await this.appointmentsService.update(latest.id, tenant.id, { date: newDate.toISOString(), time: newTime || latest.time || '' }).catch(() => {})
              this.pendingAppts.delete(sessionId)
            } else if (latest) {
              await this.prisma.appointment.update({ where: { id: latest.id }, data: { date: newDate, time: newTime || latest.time || '' } }).catch(() => {})
            }
          }
          return
        }

        // İptal
        if (/(randevu)/i.test(allMsgs) && /(iptal|vazgeç|vazgec)/i.test(message) && /(iptal|edildi)/i.test(lowerResp)) {
          const latest = await this.prisma.appointment.findFirst({ where: { tenantId: tenant.id, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) await this.prisma.appointment.update({ where: { id: latest.id }, data: { status: 'cancelled' } }).catch(() => {})
          this.pendingAppts.delete(sessionId)
          return
        }

        // Oluşturma (onay + zorunlu alanlar tam)
        const isApproval = this.isApprovalMessage(message)
        if (isApproval && pend && (pend.service || allMsgs.includes('randevu'))) {
          const cfgA = await this.getConfig(tenant.id).catch(() => null as any)
          const as: any = (cfgA && cfgA.appointmentSettings) || {}
          const dateObj = this.parseTrDate(pend.date)
          const missing: string[] = []
          if (as.requireName && !pend.name) missing.push('Ad Soyad')
          if (as.requirePhone && !(pend.phone || customerContact)) missing.push('Telefon')
          if (as.requireService && !pend.service) missing.push('Hizmet')
          if (as.requireDate && !dateObj) missing.push('Tarih')
          if (as.requireTime && !pend.time) missing.push('Saat')
          if (!missing.length) {
            if (this.appointmentsService) {
              await this.appointmentsService.create({
                tenantId: tenant.id,
                platform: 'webchat',
                customerName: pend.name || customerName,
                customerContact: pend.phone || customerContact,
                date: (dateObj || new Date(Date.now() + 86400000)).toISOString(),
                time: pend.time || '10:00',
                service: pend.service || '',
                notes: pend.note || '',
              }).catch(() => {})
            }
            this.pendingAppts.delete(sessionId)
          }
        }
      }

      // Rezervasyon tespiti (AI onayladıysa)
      if (features.reservations !== false && (allMsgs.includes('masa') || allMsgs.includes('rezervasyon') || allMsgs.includes('yer ayırt') || allMsgs.includes('yer ayır') || allMsgs.includes('arkadaş') || allMsgs.includes('grup') || allMsgs.includes('yemek')) && (lowerResp.includes('oluşturuldu') || lowerResp.includes('olusturuldu') || lowerResp.includes('alındı'))) {
        if (this.reservationsService) {
          const dateMatch = message.match(/(\d{1,2})\s*(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|\.\d{1,2}\.\d{4}|\/\d{1,2}\/\d{4})/i)
          const timeMatch = message.match(/(\d{1,2})[.:](\d{2})/)
          const guestMatch = message.match(/(\d+)\s*(?:kişi|kisi|kişilik|kisilik|arkadaş|arkadas|grup)/i)
          const resDate = dateMatch ? new Date(dateMatch[0]) : new Date(Date.now() + 86400000)
          const resTime = timeMatch ? timeMatch[0] : '20:00'
          const guests = guestMatch ? parseInt(guestMatch[1]) : 2
          await this.reservationsService.create({
            tenantId: tenant.id,
            platform: 'webchat',
            customerName,
            customerContact,
            date: resDate.toISOString(),
            time: resTime,
            guests,
          }).catch(() => {})
        }
      }
    } catch {}
  }


  private async resolveTenantId(sessionId: string): Promise<string | undefined> {
    try {
      const slug = sessionId?.split(':')[0] || 'default'
      const tenant = await this.prisma.tenant.findFirst({ where: { slug }, select: { id: true } })
      return tenant?.id
    } catch { return undefined }
  }
  private async syncLead(sessionId: string, message: string, response: string, conv: Conversation, tenantId?: string) {
    try {
      const namePattern = /(?:benim adım|adim|bana da|ben|bana) (.+?)(?:[,.]|\s|$)/i
      const phonePattern = /(0[0-9]{10}|05[0-9]{9}|\+90[0-9]{10}|5[0-9]{9}|\+90[0-9]{12})/g
      const nameMatch = message.match(namePattern)
      const phoneMatch = message.match(phonePattern)

      const userMsgs = conv.messages.filter(m => m.role === 'user').map(m => m.content)
      const needs = userMsgs.join(' | ').slice(0, 500)
      const convJson = JSON.parse(JSON.stringify(conv.messages.slice(-30)))

      const existing = await this.prisma.lead.findFirst({ where: { sessionId }, orderBy: { createdAt: 'desc' } })

      if (existing) {
        const updateData: any = {
          conversation: convJson,
          needs: needs,
        }
        if (!existing.phone && phoneMatch) updateData.phone = phoneMatch[0]
        if (!existing.name && nameMatch) updateData.name = nameMatch[1].trim()
        await this.prisma.lead.update({ where: { id: existing.id }, data: updateData })
      } else {
        await this.prisma.lead.create({
          data: {
            sessionId,
            name: nameMatch ? nameMatch[1].trim() : '',
            phone: phoneMatch ? phoneMatch[0] : '',
            needs: needs,
            conversation: convJson,
            source: 'webchat',
            tenantId: tenantId!,
          },
        })
      }
    } catch (e) {
      console.error('Lead sync error:', e)
    }
  }

  private hasAnyWord(text: string, words: string[]): boolean {
    return words.some(w => text.includes(w))
  }

  private async checkCredit(tenantId: string, platform?: string, from?: string): Promise<boolean> {
    try {
      // Per-conversation override: can only BLOCK, can't force-ALLOW when global is OFF
      if (platform && from) {
        const override = await this.prisma.conversationAiOverride.findUnique({
          where: { tenantId_platform_from: { tenantId, platform, from } },
        })
        if (override && !override.aiEnabled) { this.logger.log(`checkCredit: override BLOCK tenant=${tenantId} plat=${platform} from=${from}`); return false }
      }
      // Global toggle always applies (overrides per-conversation allow)
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { aiEnabled: true },
      })
      if (tenant && !tenant.aiEnabled) { this.logger.log(`checkCredit: GLOBAL BLOCK tenant=${tenantId} aiEnabled=${tenant.aiEnabled} plat=${platform} from=${from}`); return false }
      this.logger.log(`checkCredit: ALLOW tenant=${tenantId} aiEnabled=${tenant?.aiEnabled} plat=${platform} from=${from}`)
      return await this.tenantsService.deductCredit(tenantId)
    } catch (e: any) {
      this.logger.error('checkCredit hatasi: ' + (e?.message || 'bilinmeyen'))
      return true
    }
  }
}
