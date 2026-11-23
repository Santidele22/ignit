import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Credentials the login form posts to the interim dev login. */
export class DevLoginDto {
  @ApiProperty({ type: String, example: 'admin@example.com' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ type: String, format: 'password', example: 'secret' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
