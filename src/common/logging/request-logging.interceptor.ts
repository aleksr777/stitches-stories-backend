import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

interface AuthUser {
  id?: number;
}

type RequestWithContext = Request & {
  user?: AuthUser;
  authSessionId?: string;
  requestId?: string;
};

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const requestId =
      request.get('x-request-id')?.slice(0, 128) || randomUUID();
    const startedAt = Date.now();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    const write = (success: boolean) => {
      this.logger.log(
        JSON.stringify({
          event: 'HTTP_REQUEST',
          requestId,
          method: request.method,
          path: request.originalUrl.split('?')[0],
          status: response.statusCode,
          success,
          durationMs: Date.now() - startedAt,
          userId: request.user?.id ?? null,
          sessionId: request.authSessionId ?? null,
        }),
      );
    };

    return next.handle().pipe(
      tap({
        next: () => write(true),
        error: () => write(false),
      }),
    );
  }
}
