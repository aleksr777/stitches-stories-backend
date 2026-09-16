import { Injectable, HttpException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ErrorsService } from '../../common/errors-service/errors.service';
import { TokenType } from '../../common/types/token-type.type';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly errorsService: ErrorsService) {
    super();
  }
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: Error | undefined,
  ): TUser {
    if (err) {
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err, 'Server error (JwtAuthGuard).');
    }
    if (info?.message === 'No auth token') {
      this.errorsService.tokenNotDefined(TokenType.ACCESS);
    }
    if (
      info?.name === 'TokenExpiredError' ||
      info?.name === 'NotBeforeError' ||
      info?.name === 'JsonWebTokenError'
    ) {
      this.errorsService.invalidToken(null, TokenType.ACCESS);
    }
    if (!user) {
      this.errorsService.invalidToken(null, TokenType.ACCESS);
    }
    return user as TUser;
  }
}
