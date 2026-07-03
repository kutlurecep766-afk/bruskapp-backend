import { IsEmail, IsNotEmpty, MinLength, MaxLength } from 'class-validator'
export class RegisterDto {
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  businessName: string

  @IsEmail()
  @MaxLength(255)
  email: string

  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  password: string
}