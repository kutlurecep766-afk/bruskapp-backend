import { createHmac, timingSafeEqual } from 'crypto'

const platformSecrets: Record<string, string> = {
  trendyol: 'Trendyol-Signature',
  hepsiburada: 'X-HB-Signature',
  trendyolgo: 'X-Getir-Signature',
  yemeksepeti: 'X-Yemeksepeti-Signature',
  n11: 'X-N11-Signature',
}

export function verifyWebhookSignature(platform: string, signatureHeader: string | undefined, rawBody: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false

  const headerName = platformSecrets[platform]
  if (!headerName) return false

  try {
    const parts = signatureHeader.split(',')
    const ts = parts.find(p => p.startsWith('t='))?.slice(2)
    const sig = parts.find(p => p.startsWith('v1='))?.slice(3)
    if (!ts || !sig) return false

    const payload = `${ts}.${rawBody}`
    const expected = createHmac('sha256', secret).update(payload).digest('hex')
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  }
}
