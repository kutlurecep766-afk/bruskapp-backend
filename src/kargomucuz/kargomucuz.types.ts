export interface KargoMucuzCredentials {
  email: string
  password: string
}

export interface KargoMucuzProvider {
  _id: string
  providerEntity: string
  providerType: string
  providerServiceCode: string
  title: string
  maxDesiNumber: number
  currency: string
  imageUrl: string
  isActive: boolean
  barcodePrefix: string
  showLabelButton: boolean
}

export interface CreateAddressDto {
  title: string
  name: string
  surname: string
  phone: string
  email: string
  country: string
  city: string
  district: string
  fullAddress: string
  zipCode?: string
  company?: string
  taxNumber?: string
  taxOffice?: string
}

export interface CreateShipmentDto {
  title: string
  explanation?: string
  providerServiceCode: string
  selectedSenderAddressId: string
  selectedReceiverAddressId: string
  packageInfo: {
    desiOrKg: string
    width: string
    height: string
    depth: string
    weight: string
    itemsAmountCurrency?: string
    itemsTaxAmount?: number
    itemsAmount?: number
    items?: any[]
  }
  buyerPayShipping?: boolean
  buyerPayShippingPaymentType?: string
  buyerPayProduct?: boolean
}

export interface ShipmentResponse {
  status: boolean
  message: string
  payload: {
    shipmentTransactionId: string
    providerServiceCode: string
    savedSenderAddress: any
    savedReceieverAddress: any
  }
  code: number
}
