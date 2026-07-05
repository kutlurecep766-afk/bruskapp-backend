export interface PlatformConfig {
  platform: string
  label: string
  color: string
  gradient: string
  fields: { key: string; label: string; placeholder: string; type?: string }[]
  description: string
  webhookNote?: string
}
