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
}

export interface FAQ {
  question: string
  answer: string
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
  faqs: FAQ[]
  systemPrompt: string
  knowledgeBase: string
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
}

@Injectable()
export class WebchatService {
  private readonly logger = new Logger(WebchatService.name)
  private conversations = new Map<string, Conversation>()
  private aiApiKey: string
  private aiModel: string
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
  }

  private defaultConfig(tenantName?: string): ChatBotConfig {
    return {
      ...DEFAULT_CONFIG,
      businessName: tenantName || DEFAULT_CONFIG.businessName,
    }
  }
  async getConfig(tenantId: string): Promise<ChatBotConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webchatConfig: true, name: true },
    })

    if (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object' && Object.keys(tenant.webchatConfig as any).length > 0) {
      return { ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) }
    }

    return this.defaultConfig(tenant?.name)
  }
  async getPublicConfig(slug: string): Promise<{ businessName: string; welcomeMessage: string; products: any[] }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { webchatConfig: true, name: true },
    })
    const cfg = tenant?.webchatConfig && typeof tenant.webchatConfig === 'object' && Object.keys(tenant.webchatConfig as any).length > 0
      ? { ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) }
      : this.defaultConfig(tenant?.name)
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
    const current = tenant?.webchatConfig && typeof tenant.webchatConfig === 'object'
      ? { ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) }
      : this.defaultConfig(tenant?.name)
    if (!updates.knowledgeBase && current.knowledgeBase) {
      (updates as any).knowledgeBase = current.knowledgeBase
    }
    const merged = { ...current, ...updates }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { webchatConfig: merged as any },
    })
    return merged
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
          const dbMsgs = await this.prisma.message.findMany({
            where: { tenantId: tid, from: from || sessionKey },
            orderBy: { createdAt: 'asc' },
            take: 20,
          })
          for (const msg of dbMsgs) {
            conv.messages.push({
              role: msg.direction === 'incoming' ? 'user' : 'assistant',
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
      const response = await this.generateResponse(short, conv, sessionId, short)
      conv.messages.push({ role: 'assistant', content: response })
      if (tid) {
        this.messagesService?.create({ platform: 'webchat', from: sessionId, content: cleaned, direction: 'incoming', tenantId: tid }).catch(() => {})
        this.messagesService?.create({ platform: 'webchat', from: sessionId, content: response, direction: 'outgoing', tenantId: tid }).catch(() => {})
      }
      await this.syncLead(sessionId, cleaned, response, conv, tid || undefined).catch(() => {})
      await this.detectIntent(sessionId, cleaned, response, conv).catch(() => {}); return response
    }
    const conv = await this.getOrCreateConversation(sessionId, tid || undefined)
    if (conv.messages.length >= MAX_CONV_MSGS * 2) {
      conv.messages.splice(0, 4)
    }
    conv.messages.push({ role: 'user', content: cleaned })
    conv.lastActivity = Date.now()
    const response = await this.generateResponse(cleaned, conv, sessionId, cleaned)
    conv.messages.push({ role: 'assistant', content: response })
    if (tid) {
      this.messagesService?.create({ platform: 'webchat', from: sessionId, content: cleaned, direction: 'incoming', tenantId: tid }).catch(() => {})
      this.messagesService?.create({ platform: 'webchat', from: sessionId, content: response, direction: 'outgoing', tenantId: tid }).catch(() => {})
    }
    await this.syncLead(sessionId, cleaned, response, conv, tid || undefined).catch(() => {})
    await this.detectIntent(sessionId, cleaned, response, conv).catch(() => {}); return response
  }

  private async loadConfigForSlug(slug: string): Promise<ChatBotConfig> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { webchatConfig: true, name: true },
    })
    if (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object' && Object.keys(tenant.webchatConfig as any).length > 0) {
      return { ...this.defaultConfig(tenant.name), ...(tenant.webchatConfig as any) }
    }
    return this.defaultConfig(tenant?.name)
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
        if (orders.length > 0) ctx += `- Aktif siparisleri: ${orders.map(o => `#${o.id} (${(o.products as any[])?.[0]?.name || 'urun'} - ${o.createdAt.toLocaleDateString('tr-TR')})`).join(', ')}\n`

        // Aktif randevular
        const appointments = await this.prisma.appointment.findMany({ where: { tenantId: tid, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 3 })
        if (appointments.length > 0) ctx += `- Aktif randevulari: ${appointments.map(a => `${a.service || 'Randevu'} (${new Date(a.date).toLocaleDateString('tr-TR')} ${a.time || ''})`).join(', ')}\n`

        // Aktif rezervasyonlar
        const reservations = await this.prisma.reservation.findMany({ where: { tenantId: tid, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 3 })
        if (reservations.length > 0) ctx += `- Aktif rezervasyonlari: ${reservations.map(r => `${r.guests} kisilik (${new Date(r.date).toLocaleDateString('tr-TR')} ${r.time || ''})`).join(', ')}\n`

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
    prompt += `İşletme: ${c.description} | Adres: ${c.address} | E-posta: ${c.email} | Telefon: ${c.phone || 'Yok'} | Çalışma: ${c.hours}\n`
    prompt += `Karşılama: ${c.welcomeMessage}\n`
    prompt += `\nKurallar:\n`
    prompt += `- Turkce, kisa ve oz cevap ver.\n`
    prompt += `- ZORUNLU: Tum Turkce karakterleri dogru kullan.\n`
    prompt += `- ASAGIDAKI BILGI HAVUZUNU KULLAN. Kullanici sorusunu oku, bilgi havuzunda AYNI KONUYU bul, buldugun bilgiyi cevap olarak ver.\n`
    prompt += `- Bilgi havuzunda konuyla ilgili bilgi VARSA onu kullan, bilgi havuzundaki kural ve yonlendirmelere uygun cevap ver.\n`
    prompt += `- Bilgi havuzunda cevap yoksa KENDI profesyonel ve nazik tarzinla cevap ver, kisa ve yardimci ol. "Bu konuda su an bilgim yok" gibi kalip cevaplar KULLANMA.\n`
    prompt += `- KESINLIKLE kendi bilgini uydurma, bilgi havuzundaki bilgileri ve isletme ayarlarini kullan.\n`
    prompt += `- KESINLIKLE su tür genel cevaplari VERME: "Mesajiniz alindi", "En kisa surede donus yapilacaktir", "Iletilecektir", "Gerekli yonlendirme yapilacaktir".\n`
    prompt += `- KESINLIKLE isaretleme kullanma. Duzyazi yaz.\n`
    prompt += `- YETENEKLERIN: Siparis alabilir, randevu olusturabilir, rezervasyon yapabilir ve iptal edebilirsin.\n`
    prompt += `- SIPARIS: Kullanici siparis vermek istedigi anda "Siparisinizi aldim" de ve onayla.\n`
    prompt += `- RANDEVU/REZERVASYON: Kullanici randevu veya rezervasyon istedigi anda tarih ve saat bilgisini al, "Randevunuz/Rezervasyonunuz [tarih] [saat]'te olusturuldu" de.\n`
    prompt += `- İPTAL: Kullanici iptal istedigi once "Iptal sebebinizi ogrenebilir miyim?" diye sor. Sebebi alinca "Iptaliniz gerceklestirildi" de. Hangi randevu/siparis oldugunu anlamak icin tarih veya urun adi iste. Ornek: "Hangi tarihteki randevunuzu iptal etmek istiyorsunuz?"\n`
    if (c.systemPrompt) prompt += `- ${c.systemPrompt}\n`
    if (c.knowledgeBase) {
      prompt += `\nBILGI HAVUZU:\n${c.knowledgeBase}\n`
    }
    return prompt
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

      let res = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
          res = await fetch('https://api.deepseek.com/v1/chat/completions', {
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

  private sanitizeResponse(text: string): string {
    let clean = text
    clean = clean.replace(/\*\*(.+?)\*\*/g, '$1')
    clean = clean.replace(/\*(.+?)\*/g, '$1')
    clean = clean.replace(/__(.+?)__/g, '$1')
    clean = clean.replace(/~~(.+?)~~/g, '$1')
    clean = clean.replace(/`(.+?)`/g, '$1')
    clean = clean.replace(/#{1,6}\s/g, '')
    clean = clean.replace(/```[\s\S]*?```/g, '')
    clean = clean.replace(/https?:\/\/\S+/g, '[link]')
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
      const response = await this.generateResponse(short, conv, '', short, tenantId)
      if (response) conv.messages.push({ role: 'assistant', content: response })
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
    const response = await this.generateResponse(enhanced, conv, '', enhanced, tenantId)
    if (!response) return null
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
      const lower = cleaned.toLowerCase()
      if (features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis') || allMsgs.includes('almak istiyorum'))) {
        const productMatch = cleaned.match(/(\d+)\s*(?:adet|tane)?\s*(.+?)(?:\s*(?:ve|,|\.|$))/i)
        if (this.ordersService) this.ordersService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', products: productMatch ? [{ name: productMatch[2]?.trim() || 'Belirtilmedi', quantity: parseInt(productMatch[1]) || 1 }] : [{ name: 'Belirtilmedi', quantity: 1 }], totalAmount: 0, note: 'AI ile oluşturuldu' }).catch(() => {})
      }
      if (features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('muayene'))) {
        if (this.appointmentsService) this.appointmentsService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', date: new Date(Date.now() + 86400000).toISOString(), time: '10:00' }).catch(() => {})
      }
      if (features.reservations !== false && (allMsgs.includes('masa') || allMsgs.includes('rezervasyon') || allMsgs.includes('yer ayırt'))) {
        if (this.reservationsService) this.reservationsService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', date: new Date(Date.now() + 86400000).toISOString(), time: '20:00', guests: 2 }).catch(() => {})
      }
    } catch {}
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

      // Sipariş tespiti (AI onayladıysa)
      if (features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis') || allMsgs.includes('ısmarlamak') || allMsgs.includes('almak istiyorum') || allMsgs.includes('getir')) && lowerResp.includes('alındı')) {
        if (this.ordersService) {
          const productMatch = message.match(/(\d+)\s*(?:adet|tane|porsiyon|kg)?\s*(.+?)(?:\s*(?:ve|,|\.|$))/i)
          const products = productMatch ? [{ name: productMatch[2]?.trim() || 'Belirtilmedi', quantity: parseInt(productMatch[1]) || 1 }] : [{ name: 'Belirtilmedi', quantity: 1 }]
          await this.ordersService.create({
            tenantId: tenant.id,
            platform: 'webchat',
            customerName,
            customerContact,
            products,
            totalAmount: 0,
            note: 'AI ile oluşturuldu',
          }).catch(() => {})
        }
      }

      // Randevu tespiti (AI onayladıysa)
      if (features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('muayene') || allMsgs.includes('tedavi') || allMsgs.includes('kuaför') || allMsgs.includes('berber') || allMsgs.includes('doktor') || allMsgs.includes('klinik')) && (lowerResp.includes('oluşturuldu') || lowerResp.includes('olusturuldu') || lowerResp.includes('alındı'))) {
        if (this.appointmentsService) {
          const dateMatch = message.match(/(\d{1,2})\s*(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık|\.\d{1,2}\.\d{4}|\/\d{1,2}\/\d{4})/i)
          const timeMatch = message.match(/(\d{1,2})[.:](\d{2})/)
          const serviceMatch = message.match(/(?:için|randevusu|hizmeti)\s*(.+?)(?:\s*(?:ve|,|\.|$))/i)
          const apptDate = dateMatch ? new Date(dateMatch[0]) : new Date(Date.now() + 86400000)
          const apptTime = timeMatch ? timeMatch[0] : '10:00'
          await this.appointmentsService.create({
            tenantId: tenant.id,
            platform: 'webchat',
            customerName,
            customerContact,
            date: apptDate.toISOString(),
            time: apptTime,
            service: serviceMatch ? serviceMatch[1].trim() : '',
          }).catch(() => {})
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
