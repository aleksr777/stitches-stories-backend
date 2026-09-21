import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../common/types/role.enum';
import { CustomerOnlyGuard } from './shop.guards';

const contextFor = (role?: Role): ExecutionContext => {
  const request = {
    user: role ? { role } : undefined,
  } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('CustomerOnlyGuard', () => {
  const guard = new CustomerOnlyGuard();

  it('allows guests and customer accounts', () => {
    expect(guard.canActivate(contextFor())).toBe(true);
    expect(guard.canActivate(contextFor(Role.USER))).toBe(true);
  });

  it('rejects the shop owner', () => {
    expect(() => guard.canActivate(contextFor(Role.ADMIN))).toThrow(
      ForbiddenException,
    );
  });
});
