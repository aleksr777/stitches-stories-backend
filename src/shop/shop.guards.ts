import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RedisService } from '../common/redis-service/redis.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
@Injectable()
export class OptionalJwtGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    return req.headers.authorization ? super.canActivate(context) : true;
  }
}
@Injectable()
export class CustomerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as User | undefined;
    if (user?.role === Role.ADMIN)
      throw new ForbiddenException('Действие недоступно владельцу магазина.');
    return true;
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
