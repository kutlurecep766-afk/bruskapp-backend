import { IsNotEmpty } from 'class-validator'

export class TelegramSendDto {
  @IsNotEmpty()
  chatId: string
  @IsNotEmpty()
  message: string
}
