import { IsNotEmpty, IsOptional, IsBoolean } from 'class-validator'

export class SaveWhatsAppConfigDto {
  @IsNotEmpty()
  accessToken: string

  @IsNotEmpty()
  phoneNumberId: string

  @IsNotEmpty()
  webhookToken: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class WhatsappSendDto {
  @IsNotEmpty()
  to: string

  @IsNotEmpty()
  message: string
}
