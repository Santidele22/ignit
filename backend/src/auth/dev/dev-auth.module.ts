import { type DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity.js';
import { DevAccount } from './dev-account.entity.js';
import { DevAccountsService } from './dev-accounts.service.js';
import { DevAuthController } from './dev-auth.controller.js';
import { DevAuthService } from './dev-auth.service.js';

/**
 * Local dev auth (`AUTH_MODE=dev`). Supports the `.env` admin credentials plus
 * locally registered multi-user accounts persisted in SQLite (`dev_account`).
 *
 * Uses a dynamic `register()` factory so `TypeOrmModule.forFeature([User, DevAccount])`
 * never runs at module-import time when `AUTH_MODE !== 'dev'`, keeping
 * `dev_account` completely out of `EntitiesMetadataStorage` in `better`,
 * `neon`, and no-auth modes.
 */
@Module({})
export class DevAuthModule {
  static register(): DynamicModule {
    return {
      module: DevAuthModule,
      imports: [TypeOrmModule.forFeature([User, DevAccount])],
      controllers: [DevAuthController],
      providers: [DevAuthService, DevAccountsService],
      exports: [DevAuthService],
    };
  }
}
