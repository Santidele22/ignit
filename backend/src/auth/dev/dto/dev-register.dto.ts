import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Registration payload for creating a local account under `AUTH_MODE=dev`. */
export class DevRegisterDto {
  @ApiProperty({ type: String, example: 'Santiago' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ type: String, example: 'lector@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ type: String, format: 'password', minLength: 8, example: 'secret123' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
