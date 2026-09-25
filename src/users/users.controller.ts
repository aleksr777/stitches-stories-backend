import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SecurityAuditService } from '../audit/security-audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { clearRefreshCookie } from '../auth/auth-response.util';
import { SecurityConfigService } from '../common/security/security-config.service';
import { DeleteCurrentUserDto } from './dto/delete-current-user.dto';
import { ContactEmailChangeRequestDto } from './dto/contact-email-change-request.dto';
import { EmailChangeConfirmDto } from './dto/email-change-confirm.dto';
import { EmailChangeRequestDto } from './dto/email-change-request.dto';
import { PasswordChangeByTokenDto } from './dto/password-change.dto';
import { PasswordVerifyOldDto } from './dto/password-verify-old.dto';
import { UpdatePartialUserDataDto } from './dto/update-partial-user-data.dto';
import { EmailChangeService } from './email-change.service';
import { User } from './entities/user.entity';
import { PasswordChangeService } from './password-change.service';
import { UsersService } from './users.service';

type AuthenticatedRequest = Request & { authSessionId?: string };

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailChangeService: EmailChangeService,
    private readonly passwordChangeService: PasswordChangeService,
    private readonly securityConfig: SecurityConfigService,
    private readonly audit: SecurityAuditService,
  ) {}

  private auditContext(req: Request) {
    return {
      ipAddress: req.ip || req.socket.remoteAddress || null,
      userAgent: req.get('user-agent') ?? null,
    };
  }

  private currentSessionId(req: Request): string {
    const sessionId = (req as AuthenticatedRequest).authSessionId;
    if (!sessionId) throw new Error('Authenticated session id is missing.');
    return sessionId;
  }

  @Get('me')
  async getCurrentProfile(@Req() req: Request) {
    const user = req.user as User;
    return this.usersService.getCurrentProfile(+user.id);
  }

  @Delete('me/delete')
  async deleteCurrentUser(
    @Body() dto: DeleteCurrentUserDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as User;
    await this.usersService.deleteCurrentUser(+user.id, dto.password);
    clearRefreshCookie(res, this.securityConfig);
    void this.audit.record({
      event: 'USER_DELETED',
      userId: +user.id,
      ...this.auditContext(req),
    });
  }

  @Patch('me/partial-data/update')
  async updatePartialUserData(
    @Body() dto: UpdatePartialUserDataDto,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    return this.usersService.updatePartialUserData(+user.id, dto);
  }

  @Get('me/email/update/status')
  getUpdateEmailStatus(@Req() req: Request) {
    const user = req.user as User;
    return this.emailChangeService.getStatus(+user.id);
  }

  @Post('me/email/update/request')
  requestUpdateEmail(@Body() dto: EmailChangeRequestDto, @Req() req: Request) {
    const user = req.user as User;
    return this.emailChangeService.request(+user.id, dto);
  }

  @Post('me/email/update/confirm')
  async confirmUpdateEmail(
    @Body() dto: EmailChangeConfirmDto,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    const result = await this.emailChangeService.confirm(
      +user.id,
      dto,
      this.currentSessionId(req),
    );
    void this.audit.record({
      event: 'EMAIL_CHANGED',
      userId: +user.id,
      ...this.auditContext(req),
    });
    return result;
  }

  @Get('me/contact-email/update/status')
  getContactEmailChangeStatus(@Req() req: Request) {
    const user = req.user as User;
    return this.emailChangeService.getStatus(+user.id);
  }

  @Post('me/contact-email/update/request')
  requestContactEmailChange(
    @Body() dto: ContactEmailChangeRequestDto,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    return this.emailChangeService.requestContact(+user.id, dto);
  }

  @Post('me/contact-email/update/confirm')
  async confirmContactEmailChange(
    @Body() dto: EmailChangeConfirmDto,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    const result = await this.emailChangeService.confirmContact(+user.id, dto);
    void this.audit.record({
      event: 'CONTACT_EMAIL_CHANGED',
      userId: +user.id,
      ...this.auditContext(req),
    });
    return result;
  }

  @Post('me/password/change/request')
  verifyOldPassword(@Body() dto: PasswordVerifyOldDto, @Req() req: Request) {
    const user = req.user as User;
    return this.passwordChangeService.request(+user.id, dto.old_password);
  }

  @Post('me/password/change/confirm')
  async changePasswordByToken(
    @Body() dto: PasswordChangeByTokenDto,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    const result = await this.passwordChangeService.confirm(
      +user.id,
      dto.code,
      dto.new_password,
      this.currentSessionId(req),
    );
    void this.audit.record({
      event: 'PASSWORD_CHANGED',
      userId: +user.id,
      ...this.auditContext(req),
    });
    return result;
  }

  @Post('me/password/reset/request')
  requestCurrentUserPasswordReset(@Req() req: Request) {
    const user = req.user as User;
    return this.passwordChangeService.requestReset(+user.id);
  }

  @Post('me/password/reset/confirm')
  async confirmCurrentUserPasswordReset(
    @Body() dto: PasswordChangeByTokenDto,
    @Req() req: Request,
  ) {
    const user = req.user as User;
    const result = await this.passwordChangeService.confirmReset(
      +user.id,
      dto.code,
      dto.new_password,
      this.currentSessionId(req),
    );
    void this.audit.record({
      event: 'PASSWORD_RESET',
      userId: +user.id,
      ...this.auditContext(req),
    });
    return result;
  }
}
