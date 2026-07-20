import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common'
import { TenantsService } from '../tenants/tenants.service'
import { PrismaService } from '../prisma.service'
import { ConfigService } from '../config.service'
import { OrdersService } from '../orders/orders.service'
import { AppointmentsService } from '../appointments/appointments.service'
import { ReservationsService } from '../reservations/reservations.service'

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
const AI_TIMEOUT = 10000

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
  private conversations = new Map<string, Conversation>()
  private aiApiKey: string
  private aiModel: string
  private sessionRateMap = new Map<string, { count: number; resetAt: number }>()
  private ipRateMap = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private prisma: PrismaService,
    private tenantsService: TenantsService,
    private config: ConfigService,
    @Optional() private ordersService?: OrdersService,
    @Optional() private appointmentsService?: AppointmentsService,
    @Optional() private reservationsService?: ReservationsService,
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

    // DB'de yoksa config.json yediginden dene
    const backupKey = 'webchat_config_' + tenantId
    const backup = this.config.get(backupKey)
    if (backup) {
      try {
        const parsed = JSON.parse(backup)
        return { ...this.defaultConfig(tenant?.name), ...parsed }
      } catch {}
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
    this.config.set('webchat_config_' + tenantId, JSON.stringify(merged))
    return merged
  }

  getOrCreateConversation(sessionId: string): Conversation {
    let conv = this.conversations.get(sessionId)
    if (!conv) {
      conv = { messages: [], lastActivity: Date.now() }
      this.conversations.set(sessionId, conv)
    }
    const now = Date.now()
    for (const [id, c] of this.conversations) {
      if (now - c.lastActivity > 3600000) this.conversations.delete(id)
    }
    return conv
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
    if (cleaned.length > 500) {
      const short = cleaned.slice(0, 500) + '... [devamı kesildi]'
      const conv = this.getOrCreateConversation(sessionId)
      conv.messages.push({ role: 'user', content: short })
      conv.lastActivity = Date.now()
      const response = await this.generateResponse(short, conv, sessionId, short)
      conv.messages.push({ role: 'assistant', content: response })
      await this.syncLead(sessionId, cleaned, response, conv).catch(() => {})
      const intentMsg = await this.detectIntent(sessionId, cleaned, response, conv).catch(() => null)
      if (intentMsg) { conv.messages[conv.messages.length - 1] = { role: 'assistant', content: intentMsg }; return intentMsg }
      return response
    }
    const conv = this.getOrCreateConversation(sessionId)
    if (conv.messages.length >= MAX_CONV_MSGS * 2) {
      conv.messages.splice(0, 4)
    }
    conv.messages.push({ role: 'user', content: cleaned })
    conv.lastActivity = Date.now()
    const response = await this.generateResponse(cleaned, conv, sessionId, cleaned)
    conv.messages.push({ role: 'assistant', content: response })
    await this.syncLead(sessionId, cleaned, response, conv).catch(() => {})
    const intentMsg = await this.detectIntent(sessionId, cleaned, response, conv).catch(() => null)
    if (intentMsg) { conv.messages[conv.messages.length - 1] = { role: 'assistant', content: intentMsg }; return intentMsg }
    return response
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

  private buildBaseSystem(config: ChatBotConfig): string {
    const c = config
    let prompt = `Sen ${c.businessName} işletmesinin yapay zeka asistanısın.\n`
    prompt += `İşletme: ${c.description} | Adres: ${c.address} | E-posta: ${c.email} | Telefon: ${c.phone || 'Yok'} | Çalışma: ${c.hours}\n`
    prompt += `Karşılama: ${c.welcomeMessage}\n`
    prompt += `\nKurallar:\n`
    prompt += `- Turkce, kisa ve oz cevap ver.\n`
    prompt += `- ZORUNLU: Tum Turkce karakterleri dogru kullan.\n`
    prompt += `- ASAGIDAKI BILGI HAVUZUNU KULLAN. Kullanici sorusunu oku, bilgi havuzunda AYNI KONUYU bul, buldugun bilgiyi cevap olarak ver.\n`
    prompt += `- Bilgi havuzunda konuyla ilgili bir sey VARSA onu cevapla, "bilgim yok" deme.\n`
    prompt += `- Bilgi havuzunda konuyla ilgili HICBIR SEY yoksa "Bu konuda su an bilgim yok" de.\n`
    prompt += `- KESINLIKLE kendi bilgini kullanma, HICBIR SEY UYDURMA. Sadece bilgi havuzundakini soyle.\n`
    prompt += `- KESINLIKLE isaretleme kullanma. Duzyazi yaz.\n`
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
      const name = p.name.toLowerCase()
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

      const history = messages.slice(-8)
      aiMessages.push(...history)

      const body = JSON.stringify({
        model: this.aiModel,
        messages: aiMessages,
        temperature: 0,
        max_tokens: 400
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT)

      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
        const err = await res.text()
        return null
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

  async generatePlatformResponse(tenantId: string, platform: string, userId: string, message: string): Promise<string | null> {
    const sessionKey = `${platform}:${tenantId}:${userId}`

    if (!this.checkSessionRate(sessionKey)) {
      return null
    }

    const cleaned = this.sanitizeInput(message)
    if (!cleaned) {
      return null
    }

    if (cleaned.length > 500) {
      const short = cleaned.slice(0, 500) + '... [devamı kesildi]'
      const conv = this.getOrCreateConversation(sessionKey)
      conv.messages.push({ role: 'user', content: short })
      conv.lastActivity = Date.now()
      const hasCredit = await this.checkCredit(tenantId)
      if (!hasCredit) return null
      let response = await this.generateResponse(short, conv, '', short, tenantId)
      conv.messages.push({ role: 'assistant', content: response })
      this.tenantsService.deductCredit(tenantId).catch(() => {})
      return response
    }

    const conv = this.getOrCreateConversation(sessionKey)
    if (conv.messages.length >= MAX_CONV_MSGS * 2) {
      conv.messages.splice(0, 4)
    }

    conv.messages.push({ role: 'user', content: cleaned })
    conv.lastActivity = Date.now()
    const hasCredit = await this.checkCredit(tenantId)
    if (!hasCredit) return null
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
    let response = await this.generateResponse(enhanced, conv, '', enhanced, tenantId)
    conv.messages.push({ role: 'assistant', content: response })
    this.tenantsService.deductCredit(tenantId).catch(() => {})
    // Multi-channel lead creation
    try {
      const existingLead = await this.prisma.lead.findFirst({ where: { sessionId: sessionKey }, orderBy: { createdAt: 'desc' } })
      const uc = this.getOrCreateConversation(sessionKey)
      const ucMsgs = uc.messages.map(m => ({ role: m.role, content: m.content }))
      const needs = ucMsgs.map(m => m.content).join(' | ').slice(0, 500)
      if (existingLead) {
        await this.prisma.lead.update({ where: { id: existingLead.id }, data: { needs, conversation: ucMsgs.slice(-30) } })
      } else {
        await this.prisma.lead.create({
          data: { sessionId: sessionKey, name: userId || platform + ' Kullanıcısı', needs, conversation: ucMsgs.slice(-30), source: platform },
        })
      }
    } catch {}
    // Intent detection for platform messages - override response if action taken
    try {
      const featureTenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { features: true } })
      const features = (featureTenant?.features as any) || {}
      const pConv = this.getOrCreateConversation(sessionKey)
      const allMsgs = pConv.messages.filter(m => m.role === 'user').map(m => m.content).join(' ').toLowerCase()
      const lower = cleaned.toLowerCase()

      // İptal öncelikli
      if (allMsgs.includes('iptal') || allMsgs.includes('cancel') || allMsgs.includes('vazgeç') || allMsgs.includes('vazgectim')) {
        const reason = cleaned.replace(/(?:iptal|cancel|vazgeç|vazgectim|etmek|ediyorum|istiyorum|oldu|ettim)/gi, '').trim().slice(0, 200)
        const note = 'İptal sebebi: ' + (reason || 'Müşteri tarafından iptal edildi')
        if (features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis'))) {
          const latest = await this.prisma.order.findFirst({ where: { tenantId, customerName: userId, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) { await this.prisma.order.update({ where: { id: latest.id }, data: { status: 'cancelled', note } }).catch(() => {}); response = 'Siparişiniz iptal edildi.' }
        }
        if (features.appointments !== false && (allMsgs.includes('randevu'))) {
          const latest = await this.prisma.appointment.findFirst({ where: { tenantId, customerName: userId, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) { await this.prisma.appointment.update({ where: { id: latest.id }, data: { status: 'cancelled', notes: note } }).catch(() => {}); response = 'Randevunuz iptal edildi.' }
        }
        if (features.reservations !== false && (allMsgs.includes('rezervasyon') || allMsgs.includes('masa'))) {
          const latest = await this.prisma.reservation.findFirst({ where: { tenantId, customerName: userId, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) { await this.prisma.reservation.update({ where: { id: latest.id }, data: { status: 'cancelled', notes: note } }).catch(() => {}); response = 'Rezervasyonunuz iptal edildi.' }
        }
      }

      if (features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis') || allMsgs.includes('almak istiyorum'))) {
        const productMatch = cleaned.match(/(\d+)\s*(?:adet|tane)?\s*(.+?)(?:\s*(?:ve|,|\.|$))/i)
        if (this.ordersService) {
          const products = productMatch ? [{ name: productMatch[2]?.trim() || 'Belirtilmedi', quantity: parseInt(productMatch[1]) || 1 }] : [{ name: 'Belirtilmedi', quantity: 1 }]
          await this.ordersService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', products, totalAmount: 0, note: 'AI ile oluşturuldu' }).catch(() => {})
          response = (products[0]?.name || 'Siparişiniz') + ' siparişiniz alındı!'
        }
      }
      if (features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('muayene'))) {
        if (this.appointmentsService) {
          await this.appointmentsService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', date: new Date(Date.now() + 86400000).toISOString(), time: '10:00' }).catch(() => {})
          response = 'Randevunuz oluşturuldu.'
        }
      }
      if (features.reservations !== false && (allMsgs.includes('masa') || allMsgs.includes('rezervasyon') || allMsgs.includes('yer ayırt'))) {
        if (this.reservationsService) {
          await this.reservationsService.create({ tenantId, platform, customerName: userId || platform + ' Kullanıcısı', date: new Date(Date.now() + 86400000).toISOString(), time: '20:00', guests: 2 }).catch(() => {})
          response = 'Rezervasyonunuz oluşturuldu.'
        }
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

    const aiResponse = await this.callAI(conv.messages, config)
    if (aiResponse) return aiResponse

    for (const faq of config.faqs) {
      const q = faq.question.toLowerCase()
      const qWords = q.split(/\s+/).filter((w: string) => w.length > 2)
      const matched = qWords.filter((w: string) => lower.includes(w))
      if (matched.length >= Math.ceil(qWords.length * 0.6)) return faq.answer
    }

    const matchedProducts = config.products.filter(p => {
      const name = p.name.toLowerCase()
      return lower.includes(name)
    })

    if (this.hasAnyWord(lower, ['merhaba', 'selam', 'hey', 'hi', 'hello', 'iyi gunler', 'günaydin', 'tünaydin', 'iyi aksamlar', 'kolay gelsin'])) {
      return config.welcomeMessage
    }

    if (matchedProducts.length >= 1 && this.hasAnyWord(lower, ['fiyat', 'kac para', 'ne kadar', 'ucret'])) {
      const p = matchedProducts[0]
      return `${p.name} paketimiz ${p.price}. Detayli bilgi icin bize ulasabilirsiniz.`
    }

    if (matchedProducts.length === 1) {
      const p = matchedProducts[0]
      return `${p.name}: ${p.description} — ${p.price}.`
    }

    if (this.hasAnyWord(lower, ['adres', 'nerede', 'konum', 'telefon', 'iletisim', 'ulas', 'email', 'mail'])) {
      return `Bize ulasin:\nE-posta: ${config.email}\nAdres: ${config.address}\nCalisma saatleri: ${config.hours}`
    }

    if (this.hasAnyWord(lower, ['tesekkur', 'sagol', 'eyvallah', 'tamamdir', 'anladim'])) {
      return 'Rica ederim!'
    }

    return config.welcomeMessage
  }

  private async detectIntent(sessionId: string, message: string, response: string, conv: Conversation): Promise<string | null> {
    let result: string | null = null
    try {
      const slug = sessionId?.split(':')[0] || 'default'
      const tenant = await this.prisma.tenant.findFirst({ where: { slug }, select: { id: true, features: true, name: true } })
      if (!tenant?.id) return null
      const features = (tenant.features as any) || {}
      const lower = message.toLowerCase()
      const allMsgs = conv.messages.filter(m => m.role === 'user').map(m => m.content).join(' ').toLowerCase()

      const phoneMatch = message.match(/(0[0-9]{10}|05[0-9]{9}|\+90[0-9]{10}|5[0-9]{9})/g)
      const nameMatch = message.match(/(?:benim adım|adim|bana da|ben|bana|ismim) (.+?)(?:[,.]|\s|$)/i)
      const customerName = nameMatch ? nameMatch[1].trim() : 'Web Chat Ziyaretçisi'
      const customerContact = phoneMatch ? phoneMatch[0] : ''

      // İptal tespiti - önce kontrol et (iptal ise yenisini oluşturma)
      if (allMsgs.includes('iptal') || allMsgs.includes('cancel') || allMsgs.includes('vazgeç') || allMsgs.includes('vazgectim')) {
        const reason = message.replace(/(?:iptal|cancel|vazgeç|vazgectim|etmek|ediyorum|istiyorum|oldu|ettim|istiyorum)/gi, '').trim().slice(0, 200) || 'Müşteri tarafından iptal edildi'
        const note = 'İptal sebebi: ' + reason
        if (features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis') || allMsgs.includes('siparişimi') || allMsgs.includes('siparisimi'))) {
          const latest = await this.prisma.order.findFirst({ where: { tenantId: tenant.id, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) { await this.prisma.order.update({ where: { id: latest.id }, data: { status: 'cancelled', note } }).catch(() => {}); result = 'Siparişiniz iptal edildi. Geçerli bir neden belirttiyseniz not olarak eklendi.' }
        }
        if (!result && features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('randevumu') || allMsgs.includes('randevuyu'))) {
          const latest = await this.prisma.appointment.findFirst({ where: { tenantId: tenant.id, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) { await this.prisma.appointment.update({ where: { id: latest.id }, data: { status: 'cancelled', notes: note } }).catch(() => {}); result = 'Randevunuz iptal edildi.' }
        }
        if (!result && features.reservations !== false && (allMsgs.includes('rezervasyon') || allMsgs.includes('rezervasyonu') || allMsgs.includes('masayı') || allMsgs.includes('masa'))) {
          const latest = await this.prisma.reservation.findFirst({ where: { tenantId: tenant.id, customerName, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' } })
          if (latest) { await this.prisma.reservation.update({ where: { id: latest.id }, data: { status: 'cancelled', notes: note } }).catch(() => {}); result = 'Rezervasyonunuz iptal edildi.' }
        }
      }

      // Sipariş tespiti (iptal degilse)
      if (!result && features.orders !== false && (allMsgs.includes('sipariş') || allMsgs.includes('siparis') || allMsgs.includes('ısmarlamak') || allMsgs.includes('almak istiyorum') || allMsgs.includes('getir'))) {
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
          const pName = products[0]?.name || 'siparişiniz'
          result = `${pName} siparişiniz alındı! En kısa sürede hazırlanıp teslim edilecektir.`
        }
      }

      // Randevu tespiti
      if (!result && features.appointments !== false && (allMsgs.includes('randevu') || allMsgs.includes('muayene') || allMsgs.includes('tedavi') || allMsgs.includes('kuaför') || allMsgs.includes('berber') || allMsgs.includes('doktor') || allMsgs.includes('klinik'))) {
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
          const dateStr = apptDate.toLocaleDateString('tr-TR')
          result = `Randevunuz ${dateStr} ${apptTime}'de oluşturuldu. İptal veya değişiklik için bize ulaşabilirsiniz.`
        }
      }

      // Rezervasyon tespiti
      if (!result && features.reservations !== false && (allMsgs.includes('masa') || allMsgs.includes('rezervasyon') || allMsgs.includes('yer ayırt') || allMsgs.includes('yer ayır') || allMsgs.includes('arkadaş') || allMsgs.includes('grup') || allMsgs.includes('yemek'))) {
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
          const dateStr = resDate.toLocaleDateString('tr-TR')
          result = `${guests} kişilik rezervasyonunuz ${dateStr} ${resTime}'de oluşturuldu.`
        }
      }
    } catch {}
    return result
  }

  private async syncLead(sessionId: string, message: string, response: string, conv: Conversation) {
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

  private async checkCredit(tenantId: string): Promise<boolean> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { aiEnabled: true },
      })
      if (tenant && !tenant.aiEnabled) return false
      return await this.tenantsService.deductCredit(tenantId)
    } catch {
      return true
    }
  }
}
