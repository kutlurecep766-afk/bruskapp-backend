import { IsNotEmpty, Length, IsOptional, IsEmail } from 'class-validator'
export class Verify2faDto {
  @IsNotEmpty()
  @Length(6, 6)
  token: string

  @IsOptional()
  @IsEmail()
  email?: string
}