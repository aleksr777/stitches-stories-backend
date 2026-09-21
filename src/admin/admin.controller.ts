import {
  Get,
  Patch,
  Delete,
  Body,
  Req,
  Query,
  Param,
  Controller,
  UseGuards,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { SecurityAuditService } from '../audit/security-audit.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { AdminPasswordDto } from './dto/admin-password.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { GetUsersQueryDto } from './dto/get-users-query.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
    private readonly audit: SecurityAuditService,
  ) {}

  private record(
    req: Request,
    event: string,
    targetUserId: number,
    details: Record<string, unknown> = {},
  ) {
    const admin = req.user as User;
    void this.audit.record({
      event,
      userId: +admin.id,
      ipAddress: req.ip || req.socket.remoteAddress || null,
      userAgent: req.get('user-agent') ?? null,
      details: { target_user_id: targetUserId, ...details },
    });
  }

  @Get('users/find')
  getUsers(@Query() q: GetUsersQueryDto) {
    return this.adminService.getUsersByQuery(
      q.limit,
      q.offset,
      q.field,
      q.search,
    );
  }

  @Get('users/:id/sessions')
  async getUserSessions(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.adminService.getUserById(id);
    const sessions = await this.authService.getSessions(id, null);
    this.record(req, 'ADMIN_USER_SESSIONS_VIEWED', id);
    return { sessions };
  }

  @Delete('users/:id/sessions/:sessionId')
  async revokeUserSession(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    await this.adminService.getUserById(id);
    await this.authService.revokeSession(id, sessionId, 'admin_revoked');
    this.record(req, 'ADMIN_USER_SESSION_REVOKED', id, {
      target_session_id: sessionId,
    });
    return { message: 'Session terminated successfully.' };
  }

  @Delete('users/:id/sessions')
  async revokeAllUserSessions(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.adminService.getUserById(id);
    await this.authService.revokeAllSessions(id, 'admin_revoked_all');
    this.record(req, 'ADMIN_USER_SESSIONS_REVOKED_ALL', id);
    return { message: 'All user sessions terminated successfully.' };
  }

  @Get('users/:id')
  getUser(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getUserById(id);
  }

  @Delete('users/delete/:id')
  async deleteUser(
    @Body() dto: AdminPasswordDto,
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const admin = req.user as User;
    await this.adminService.deleteUserById(+admin.id, +id, dto.password);
    this.record(req, 'ADMIN_USER_DELETED', +id);
  }

  @Patch('users/block/:id')
  async blockUser(
    @Body() dto: BlockUserDto,
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const admin = req.user as User;
    const blockedReason = dto.blocked_reason ? dto.blocked_reason : '';
    await this.adminService.blockUserById(+admin.id, +id, blockedReason);
    this.record(req, 'ADMIN_USER_BLOCKED', +id);
  }

  @Patch('users/unblock/:id')
  async unblockUser(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.adminService.unblockUserById(+id);
    this.record(req, 'ADMIN_USER_UNBLOCKED', +id);
  }
}
