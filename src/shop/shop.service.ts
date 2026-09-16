import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { LegalService, canonical, digest } from '../legal/legal.service';
import { CreateRequestDto, ProductDto } from './shop.dto';
import { Favorite, OrderRequest, Product } from './shop.entities';
@Injectable()
export class ShopService {
  constructor(
    private readonly db: DataSource,
    private readonly legal: LegalService,
  ) {}
  products(admin = false) {
    return this.db.getRepository(Product).find({
      where: admin
        ? {}
        : {
            active: true,
            ...(process.env.NODE_ENV === 'production' ? { isDemo: false } : {}),
          },
      order: { featured: 'DESC', name: 'ASC' },
      take: 500,
    });
  }
  async product(slug: string) {
    const p = await this.db
      .getRepository(Product)
      .findOneBy({ slug, active: true });
    if (!p || (process.env.NODE_ENV === 'production' && p.isDemo))
      throw new NotFoundException('Изделие не найдено.');
    return p;
  }
  private receipt(order: OrderRequest) {
    return {
      id: order.id,
      number: order.id.slice(0, 8).toUpperCase(),
      subtotalRub: order.subtotalRub,
      status: order.status,
      createdAt: order.createdAt,
    };
  }
  async createRequest(dto: CreateRequestDto, userId: number | null) {
    this.legal.assertReferences([dto.document], ['offer']);
    if (new Set(dto.items.map((i) => i.productId)).size !== dto.items.length)
      throw new BadRequestException('В запросе повторяются изделия.');
    const payloadHash = digest(
      canonical({
        ...dto,
        userId,
        items: [...dto.items].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        ),
      }),
    );
    const replay = (existing: OrderRequest) => {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException('Ключ запроса уже использован.');
      return this.receipt(existing);
    };
    const existing = await this.db
      .getRepository(OrderRequest)
      .findOneBy({ requestKey: dto.requestKey });
    if (existing) return replay(existing);
    try {
      return await this.db.transaction(async (m) => {
        const products = await m
          .getRepository(Product)
          .createQueryBuilder('p')
          .where('p.id IN (:...ids)', {
            ids: dto.items.map((i) => i.productId),
          })
          .setLock('pessimistic_read')
          .getMany();
        const items = dto.items.map((i) => {
          const p = products.find((p) => p.id === i.productId);
          if (
            !p ||
            !p.active ||
            p.stock < i.quantity ||
            (process.env.NODE_ENV === 'production' && p.isDemo)
          )
            throw new ConflictException(
              'Изделие недоступно в выбранном количестве.',
            );
          if (p.priceRub !== i.expectedPriceRub)
            throw new ConflictException(
              'Цена изменилась. Проверьте сумму и отправьте запрос снова.',
            );
          return {
            productId: p.id,
            slug: p.slug,
            name: p.name,
            quantity: i.quantity,
            priceRub: p.priceRub,
          };
        });
        const order = await m.save(
          OrderRequest,
          m.create(OrderRequest, {
            ...dto,
            userId,
            phone: dto.phone ?? null,
            comment: dto.comment ?? '',
            items,
            payloadHash,
            subtotalRub: items.reduce(
              (sum, i) => sum + i.priceRub * i.quantity,
              0,
            ),
          }),
        );
        return this.receipt(order);
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        const saved = await this.db
          .getRepository(OrderRequest)
          .findOneBy({ requestKey: dto.requestKey });
        if (saved) return replay(saved);
      }
      throw err;
    }
  }
  requests(userId: number) {
    return this.db
      .getRepository(OrderRequest)
      .find({ where: { userId }, order: { createdAt: 'DESC' }, take: 200 });
  }
  async favorites(userId: number) {
    return (await this.db.getRepository(Favorite).findBy({ userId })).map(
      (f) => f.productId,
    );
  }
  async favorite(userId: number, productId: string, enabled: boolean) {
    if (enabled) {
      const p = await this.db
        .getRepository(Product)
        .findOneBy({ id: productId, active: true });
      if (!p) throw new NotFoundException();
      await this.db
        .getRepository(Favorite)
        .upsert({ userId, productId }, ['userId', 'productId']);
    } else await this.db.getRepository(Favorite).delete({ userId, productId });
    return { saved: enabled };
  }
  allRequests() {
    return this.db
      .getRepository(OrderRequest)
      .find({ order: { createdAt: 'DESC' }, take: 200 });
  }
  async updateStatus(id: string, status: string) {
    const result = await this.db
      .getRepository(OrderRequest)
      .update(id, { status });
    if (!result.affected) throw new NotFoundException();
    return { updated: true };
  }
  async saveProduct(dto: ProductDto, id?: string) {
    const repo = this.db.getRepository(Product);
    if (id && !(await repo.existsBy({ id }))) throw new NotFoundException();
    try {
      return await repo.save(repo.create({ ...dto, ...(id ? { id } : {}) }));
    } catch (e) {
      if (
        e instanceof QueryFailedError &&
        (e.driverError as { code?: string }).code === '23505'
      )
        throw new ConflictException('Такой адрес изделия уже существует.');
      throw e;
    }
  }
}
