import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity.js';
import { DevAuthController } from './dev-auth.controller.js';
import { DevAuthService } from './dev-auth.service.js';

/**
 * Interim dev auth (`AUTH_MODE=dev`). It only carries the controller and the
 * service that verifies the hardcoded `.env` credentials and signs the session
 * cookie; `AuthModule` decides whether it is mounted and registers its guard.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [DevAuthController],
  providers: [DevAuthService],
  exports: [DevAuthService],
})
export class DevAuthModule {}
