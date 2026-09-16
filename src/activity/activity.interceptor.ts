import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ActivityService } from './activity.service';
import { JwtPayload } from '../common/types/jwt-tokens.type';

type ReqUser = Partial<JwtPayload> & { id?: number };
type ActivityRequest = {
  user?: ReqUser;
  authSessionId?: string;
};

@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<ActivityRequest>();
    const user = req.user;
    const userId =
      typeof user?.id === 'number'
        ? user.id
        : typeof user?.sub === 'number'
          ? user.sub
          : undefined;

    if (typeof userId === 'number' && typeof req.authSessionId === 'string') {
      void this.activity
        .setSessionActivity(userId, req.authSessionId)
        .catch(() => undefined);
    }

    return next.handle();
  }
}
