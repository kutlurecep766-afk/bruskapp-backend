import { IsOptional, IsString } from 'class-validator'

export class WebchatMessageDto {
  @IsOptional()
  @IsString()
  sessionId?: string

  @IsOptional()
  @IsString()
  message?: string
}
