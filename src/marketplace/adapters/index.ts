import { trendyolToCommon } from './trendyol.adapter'
import { hepsiburadaToCommon } from './hepsiburada.adapter'
import { yemeksepetiToCommon } from './yemeksepeti.adapter'
import { n11ToCommon } from './n11.adapter'
import { trendyolgoToCommon } from './trendyolgo.adapter'
import type { OrderInput } from './marketplace-order-adapter.interface'

export { saveCommonOrder } from './save-common-order'
export type { OrderInput, OrderItemInput, IMarketplaceOrderAdapter } from './marketplace-order-adapter.interface'

const adapterMap: Record<string, (raw: any, tenantId: string) => OrderInput> = {
  trendyol: trendyolToCommon,
  hepsiburada: hepsiburadaToCommon,
  yemeksepeti: yemeksepetiToCommon,
  n11: n11ToCommon,
  trendyolgo: trendyolgoToCommon,
}

export function toCommonOrder(platform: string, raw: any, tenantId: string): OrderInput {
  const fn = adapterMap[platform]
  if (!fn) throw new Error(`Bilinmeyen platform: ${platform}`)
  return fn(raw, tenantId)
}
