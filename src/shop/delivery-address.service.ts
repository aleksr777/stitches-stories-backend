import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { DeliveryAddressDto, addressDetails } from './delivery-address.dto';
import { DeliveryAddress } from './delivery-address.entity';

const MAX_ADDRESSES = 10;
const publicAddress = (address: DeliveryAddress) => ({
  id: address.id,
  ...addressDetails(address),
});

export async function saveDeliveryAddress(
  manager: EntityManager,
  userId: number,
  dto: DeliveryAddressDto,
) {
  // Lock the owner so simultaneous requests cannot exceed the address limit.
  const user = await manager.findOne(User, {
    where: { id: userId },
    select: { id: true },
    lock: { mode: 'pessimistic_write' },
  });
  if (!user) throw new NotFoundException('Профиль не найден.');
  const repository = manager.getRepository(DeliveryAddress);
  if ((await repository.countBy({ userId })) >= MAX_ADDRESSES)
    throw new BadRequestException('Можно сохранить не более 10 адресов.');
  return repository.save(repository.create({ userId, ...addressDetails(dto) }));
}

@Injectable()
export class DeliveryAddressService {
  constructor(private readonly db: DataSource) {}

  async list(userId: number) {
    const addresses = await this.db.getRepository(DeliveryAddress).find({
      where: { userId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return addresses.map(publicAddress);
  }

  create(userId: number, dto: DeliveryAddressDto) {
    return this.db
      .transaction((manager) => saveDeliveryAddress(manager, userId, dto))
      .then(publicAddress);
  }

  async update(userId: number, id: string, dto: DeliveryAddressDto) {
    const repository = this.db.getRepository(DeliveryAddress);
    const result = await repository.update({ id, userId }, addressDetails(dto));
    if (!result.affected) throw new NotFoundException('Адрес не найден.');
    return publicAddress(await repository.findOneByOrFail({ id, userId }));
  }

  async remove(userId: number, id: string) {
    const result = await this.db
      .getRepository(DeliveryAddress)
      .delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Адрес не найден.');
    return { deleted: true };
  }
}
