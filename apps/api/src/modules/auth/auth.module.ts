import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './local.strategy';
import { PermissionsService } from './permissions.service';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [PassportModule, DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, PermissionsService],
  exports: [PermissionsService],
})
export class AuthModule {}
