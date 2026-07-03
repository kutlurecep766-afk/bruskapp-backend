import { IsEmail, IsNotEmpty, MinLength, MaxLength } from 'class-validator'
export class SetupDto {
  @IsEmail()
  @MaxLength(255)
  email: string

  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(128)
  password: string
}