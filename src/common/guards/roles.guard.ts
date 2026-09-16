import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../types/role.enum';
import { ErrorsService } from '../errors-service/errors.service';
import { ErrMsg } from '../errors-service/error-messages.type';

interface AuthUser {
  id: number;
  role: Role;
}
type RequestWithUser = Request & { user?: AuthUser };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly errorsService: ErrorsService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requiredRoles?.length) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const userRole = req.user?.role;
    if (!userRole || !requiredRoles.includes(userRole)) {
      this.errorsService.forbidden(ErrMsg.INSUFFICIENT_ACCESS_RIGHTS);
    }
    return true;
  }
}
