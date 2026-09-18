import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../common/types/role.enum';
import { LegalService } from '../legal/legal.service';
import { CreateRequestDto } from './shop.dto';
import { ShopService } from './shop.service';

describe('ShopService owner customer actions', () => {
  const shop = new ShopService({} as DataSource, {} as LegalService);
  const request = {
    requestKey: '11111111-1111-4111-8111-111111111111',
  } as CreateRequestDto;
  const productId = '22222222-2222-4222-8222-222222222222';

  it('rejects purchase requests and favorite changes from the shop owner', async () => {
    await expect(
      shop.createRequest(request, 1, Role.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      shop.favorite(1, productId, true, Role.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      shop.favorite(1, productId, false, Role.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
