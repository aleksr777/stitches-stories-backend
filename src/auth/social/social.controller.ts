import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import { SecurityConfigService } from '../../common/security/security-config.service';
import { AcceptanceDto } from '../../legal/legal.dto';
import { JwtTokens } from '../../common/types/jwt-tokens.type';
import { AuthService } from '../auth.service';
import { SocialProvider } from '../entities/social-identity.entity';
import { RefreshOriginGuard } from '../guards/refresh-origin.guard';
import { PublicVerificationRateLimitService } from '../public-verification-rate-limit.service';
import { SocialAccountService } from './social-account.service';
import { SocialFlowService } from './social-flow.service';
import { SocialProviderService } from './social-provider.service';
import { SocialRegistrationDto } from './social.dto';
import { LocalAuthGuard } from '../guards/local-auth.guard';
import { User } from '../../users/entities/user.entity';

@Controller('auth/social')
export class SocialController {
  constructor(
    private readonly flow: SocialFlowService,
    private readonly providers: SocialProviderService,
    private readonly accounts: SocialAccountService,
    private readonly auth: AuthService,
    private readonly rate: PublicVerificationRateLimitService,
    private readonly security: SecurityConfigService,
  ) {}
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.security.getRefreshCookieSecure(),
      sameSite: 'lax',
      path: '/api/auth/social',
      maxAge: 600_000,
    };
  }
  private cookie(req: Request, name: string): string {
    const value: unknown = (
      req.cookies as Record<string, unknown> | undefined
    )?.[name];
    return typeof value === 'string' ? value : '';
  }
  private async limit(req: Request) {
    await this.rate.consume(req.ip || req.socket.remoteAddress || 'unknown');
  }
  private result(res: Response, tokens: JwtTokens) {
    res.cookie('refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: this.security.getRefreshCookieSecure(),
      sameSite: this.security.getRefreshCookieSameSite(),
      path: '/api/auth',
      priority: 'high',
      maxAge: Math.max(
        0,
        (tokens.refresh_token_expires ?? 0) * 1000 - Date.now(),
      ),
    });
    res.clearCookie('social_pending', this.cookieOptions());
    return {
      access_token: tokens.access_token,
      access_token_expires: tokens.access_token_expires,
    };
  }
  @Get('providers')
  @Header('Cache-Control', 'no-store')
  available() {
    return this.providers.available();
  }

  @Post(':provider/start')
  @UseGuards(RefreshOriginGuard)
  @Header('Cache-Control', 'no-store')
  async start(
    @Param('provider') provider: SocialProvider,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limit(req);
    const result = await this.flow.begin(provider);
    res.cookie('social_binding', result.binding, this.cookieOptions());
    res.clearCookie('social_pending', this.cookieOptions());
    return { url: result.url };
  }
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: SocialProvider,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const frontend = new URL('/auth/social', process.env.FRONTEND_URL);
    try {
      const string = (key: string) =>
        typeof query[key] === 'string' && query[key].length <= 4096
          ? query[key]
          : '';
      if (query.error || !string('code')) throw new Error();
      const pending = await this.flow.callback(
        provider,
        string('state'),
        this.cookie(req, 'social_binding'),
        string('code'),
        string('device_id'),
      );
      res.cookie('social_pending', pending, this.cookieOptions());
    } catch {
      res.clearCookie('social_pending', this.cookieOptions());
      frontend.searchParams.set('error', 'failed');
    }
    res.clearCookie('social_binding', this.cookieOptions());
    res.redirect(303, frontend.toString());
  }
  @Get('pending')
  @Header('Cache-Control', 'no-store')
  async pending(@Req() req: Request) {
    const identity = await this.flow.pending(
      this.cookie(req, 'social_pending'),
    );
    const link = await this.accounts.find(identity);
    if (link) await this.accounts.customer(link.userId);
    return { provider: identity.provider, registered: Boolean(link) };
  }
  @Post('registration/request')
  @UseGuards(RefreshOriginGuard)
  @Header('Cache-Control', 'no-store')
  async register(@Req() req: Request, @Body() dto: SocialRegistrationDto) {
    await this.limit(req);
    const identity = await this.flow.pending(
      this.cookie(req, 'social_pending'),
    );
    if (identity.provider !== 'vk')
      throw new BadRequestException(
        'Для Яндекс ID используйте быструю регистрацию.',
      );
    return this.accounts.register(identity, dto.email, {
      name: dto.name,
      documents: dto.documents,
    });
  }
  @Post('registration/yandex')
  @UseGuards(RefreshOriginGuard)
  @Header('Cache-Control', 'no-store')
  async registerYandex(
    @Req() req: Request,
    @Body() dto: AcceptanceDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limit(req);
    const token = this.cookie(req, 'social_pending');
    const identity = await this.flow.pending(token);
    const user = await this.accounts.registerYandex(identity, dto.documents);
    await this.flow.pending(token, true);
    return this.result(
      res,
      await this.auth.loginNewSession(user.id, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      }),
    );
  }
  @Post('login')
  @UseGuards(RefreshOriginGuard)
  @Header('Cache-Control', 'no-store')
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limit(req);
    const identity = await this.flow.pending(
      this.cookie(req, 'social_pending'),
      true,
    );
    const user = await this.accounts.login(identity);
    return this.result(
      res,
      await this.auth.loginNewSession(user.id, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      }),
    );
  }
  @Post('link')
  @UseGuards(RefreshOriginGuard, LocalAuthGuard)
  @Header('Cache-Control', 'no-store')
  async link(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limit(req);
    const identity = await this.flow.pending(
      this.cookie(req, 'social_pending'),
    );
    const user = await this.accounts.link(identity, req.user as User);
    await this.flow.pending(this.cookie(req, 'social_pending'), true);
    return this.result(
      res,
      await this.auth.loginNewSession(user.id, {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      }),
    );
  }
}
