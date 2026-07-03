import { IsNotEmpty } from 'class-validator'
export class WhatsappTestDto {
  @IsNotEmpty()
  phoneNumber: string
  @IsNotEmpty()
  apiKey: string
}
export class WhatsappSendDto {
  @IsNotEmpty()
  phoneNumber: string
  @IsNotEmpty()
  apiKey: string
  @IsNotEmpty()
  to: string
  @IsNotEmpty()
  message: string
}