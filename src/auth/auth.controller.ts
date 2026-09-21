import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import { SecurityConfigService } from '../common/security/security-config.service';
import { AuthResponse, JwtTokens } from '../common/types/jwt-tokens.type';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import { AdminLoginService } from './admin-login.service';
import { AuthService } from './auth.service';
import {
  AdminLoginChallengeDto,
  AdminLoginConfirmDto,
} from './dto/admin-login-confirm.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { RegistrationConfirmDto } from './dto/registration-confirm.dto';
import { RegistrationRequestDto } from './dto/registration-request.dto';
import { RegistrationResendDto } from './dto/registration-resend.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { RefreshOriginGuard } from './guards/refresh-origin.guard';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { PasswordResetService } from './password-reset.service';
import { PublicVerificationRateLimitService } from './public-verification-rate-limit.service';
import { RegistrationService } from './registration.service';

type RequestWithSafeCookies = Omit<Request, 'cookies'> & {
  cookies?: Record<string, unknown>;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminLoginService: AdminLoginService,
    private readonly registrationService: RegistrationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly publicVerificationRateLimitService: PublicVerificationRateLimitService,
    private readonly securityConfig: SecurityConfigService,
  ) {}

  private getRefreshCookieOptions(maxAge?: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.securityConfig.getRefreshCookieSecure(),
      sameSite: this.securityConfig.getRefreshCookieSameSite(),
      priority: 'high',
      path: '/api/auth',
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  }

  private setRefreshCookie(res: Response, tokens: JwtTokens): void {
    const maxAge =
      typeof tokens.refresh_token_expires === 'number'
        ? Math.max(tokens.refresh_token_expires * 1000 - Date.now(), 0)
        : undefined;
    res.cookie(
      'refresh_token',
      tokens.refresh_token,
      this.getRefreshCookieOptions(maxAge),
    );
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('refresh_token', this.getRefreshCookieOptions());
  }

  private getAuthResponse(tokens: JwtTokens): AuthResponse {
    return {
      access_token: tokens.access_token,
      access_token_expires: tokens.access_token_expires,
    };
  }

  private getRequestIp(req: Request) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  private getSessionContext(req: Request) {
    return {
      ipAddress: this.getRequestIp(req),
      userAgent: req.get('user-agent') ?? null,
    };
  }

  private getRefreshToken(req: Request): string | null {
    const request = req as RequestWithSafeCookies;
    const token = request.cookies?.['refresh_token'];
    return typeof token === 'string' ? token : null;
  }

  private isJwtTokens(value: unknown): value is JwtTokens {
    if (typeof value !== 'object' || value === null) return false;
    const tokens = value as Partial<Record<keyof JwtTokens, unknown>>;
    return (
      typeof tokens.access_token === 'string' &&
      typeof tokens.refresh_token === 'string' &&
      (typeof tokens.access_token_expires === 'number' ||
        tokens.access_token_expires === null) &&
      (typeof tokens.refresh_token_expires === 'number' ||
        tokens.refresh_token_expires === null)
    );
  }

  private handleAuthResult(res: Response, result: unknown) {
    if (!this.isJwtTokens(result)) return result;
    this.setRefreshCookie(res, result);
    return this.getAuthResponse(result);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as User;

    if (user.is_blocked) {
      this.clearRefreshCookie(res);
      return {
        blocked: true,
        blocked_reason: user.blocked_reason ?? null,
        contact_email: await this.authService.getAdministratorEmail(),
      };
    }

    if (user.role === Role.ADMIN) {
      this.clearRefreshCookie(res);
      await this.publicVerificationRateLimitService.consume(
        this.getRequestIp(req),
      );
      return this.adminLoginService.request(user);
    }

    const tokens = await this.authService.loginNewSession(
      user.id,
      this.getSessionContext(req),
    );
    return this.handleAuthResult(res, tokens);
  }

  @Post('login/admin/confirm')
  async confirmAdministratorLogin(
    @Req() req: Request,
    @Body() dto: AdminLoginConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.adminLoginService.confirm(
      dto.challenge_id,
      dto.code,
    );
    const tokens = await this.authService.loginNewSession(
      user.id,
      this.getSessionContext(req),
    );
    return this.handleAuthResult(res, tokens);
  }

  @Post('login/admin/resend')
  async resendAdministratorLoginCode(
    @Req() req: Request,
    @Body() dto: AdminLoginChallengeDto,
  ) {
    await this.publicVerificationRateLimitService.consume(
      this.getRequestIp(req),
    );
    return this.adminLoginService.resend(dto.challenge_id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('session')
  @HttpCode(204)
  validateSession(): void {}

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as User;
    await this.authService.logout(+user.id, req.headers.authorization);
    this.clearRefreshCookie(res);
    return { message: 'Logged out successfully.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as User;
    await this.authService.logoutAll(+user.id);
    this.clearRefreshCookie(res);
    return { message: 'Logged out from all sessions successfully.' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@Req() req: Request) {
    const user = req.user as User;
    const currentSessionId = this.authService.getSessionIdFromToken(
      req.headers.authorization,
    );
    return {
      sessions: await this.authService.getSessions(+user.id, currentSessionId),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:sessionId')
  async revokeSession(
    @Req() req: Request,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as User;
    const currentSessionId = this.authService.getSessionIdFromToken(
      req.headers.authorization,
    );
    await this.authService.revokeSession(+user.id, sessionId, 'user_revoked');
    if (currentSessionId === sessionId) this.clearRefreshCookie(res);
    return { message: 'Session revoked successfully.' };
  }

  @UseGuards(RefreshOriginGuard, RefreshTokenGuard)
  @Post('refresh-tokens')
  async refreshJwtTokens(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as User;
    const tokens = await this.authService.refreshJwtTokens(
      +user.id,
      this.getRefreshToken(req),
    );
    return this.handleAuthResult(res, tokens);
  }

  @Post('registration/request')
  async requestRegistration(
    @Req() req: Request,
    @Body() dto: RegistrationRequestDto,
  ) {
    await this.publicVerificationRateLimitService.consume(
      this.getRequestIp(req),
    );
    return this.registrationService.request(dto.email, dto.password, {
      name: dto.name,
      documents: dto.documents,
    });
  }

  @Post('registration/resend')
  async resendRegistrationCode(
    @Req() req: Request,
    @Body() dto: RegistrationResendDto,
  ) {
    await this.publicVerificationRateLimitService.consume(
      this.getRequestIp(req),
    );
    return this.registrationService.resend(dto.email);
  }

  @Post('registration/confirm')
  async confirmRegistration(
    @Body() dto: RegistrationConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.registrationService.confirm(dto.code, dto.email);
    return this.handleAuthResult(res, result);
  }

  @Post('password-reset/request')
  async requestPasswordReset(
    @Req() req: Request,
    @Body() dto: PasswordResetRequestDto,
  ) {
    await this.publicVerificationRateLimitService.consume(
      this.getRequestIp(req),
    );
    return this.passwordResetService.request(dto.email);
  }

  @Post('password-reset/confirm')
  async resetPassword(
    @Req() req: Request,
    @Body() dto: PasswordResetConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.passwordResetService.confirm(
      dto.code,
      dto.new_password,
      dto.email,
    );
    const user = await this.authService.validateUserByEmailAndPassword(
      dto.email,
      dto.new_password,
    );
    this.authService.isUserBlocked(user);
    const tokens = await this.authService.loginNewSession(
      user.id,
      this.getSessionContext(req),
    );
    return this.handleAuthResult(res, tokens);
  }
}
