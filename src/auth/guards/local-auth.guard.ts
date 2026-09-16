import { ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { LoginDto } from '../dto/login.dto';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  private readonly pipe = new ValidationPipe({ whitelist: true });

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: Request = context.switchToHttp().getRequest<Request>();
    await this.pipe.transform(req.body, { type: 'body', metatype: LoginDto });
    return (await super.canActivate(context)) as boolean;
  }
}
