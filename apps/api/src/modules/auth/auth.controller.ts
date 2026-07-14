import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedIdentity } from './auth.service';
import './session.types';

@Controller('auth')
export class AuthController {
  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request) {
    const identity = req.user as AuthenticatedIdentity;

    // Regenerar la sesión en login previene session fixation: un id de sesión
    // emitido antes de autenticar nunca debe quedar válido después.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.userId = identity.userId;
    req.session.tenantId = identity.tenantId;
    req.session.pgRole = identity.pgRole;
    req.session.permissions = identity.permissions;

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
    return { ok: true };
  }
}
