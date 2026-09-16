import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RedisService } from '../common/redis-service/redis.service';
import { ErrorsService } from '../common/errors-service/errors.service';
@Injectable()
export class OptionalJwtGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    return req.headers.authorization ? super.canActivate(context) : true;
  }
}
@Injectable()
export class ShopWriteGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly errors: ErrorsService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    let count: number;
    try {
      count = await this.redis.incrWithExpire(
        'shop:write:' + req.ip + ':' + req.path,
        600,
      );
    } catch {
      throw new ServiceUnavailableException('Попробуйте позже.');
    }
    if (count > 10)
      this.errors.tooManyRequests(
        'Слишком много запросов. Попробуйте позже.',
        600,
      );
    return true;
  }
}
