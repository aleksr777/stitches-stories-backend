import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ErrorsService } from '../../common/errors-service/errors.service';
import { SecurityConfigService } from '../../common/security/security-config.service';

const INVALID_REFRESH_ORIGIN_MESSAGE = 'Invalid request origin.';

@Injectable()
export class RefreshOriginGuard implements CanActivate {
  constructor(
    private readonly securityConfig: SecurityConfigService,
    private readonly errorsService: ErrorsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    if (!this.securityConfig.isFrontendOrigin(origin)) {
      this.errorsService.forbidden(INVALID_REFRESH_ORIGIN_MESSAGE);
    }

    return true;
  }
}
