import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError, In } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { LegalService, canonical, digest } from '../legal/legal.service';
import { CreateRequestDto, ProductDto } from './shop.dto';
import { Favorite, OrderRequest, Product, ProductImage } from './shop.entities';
import {
  MAX_PRODUCT_IMAGES,
  ProductImageUpload,
  VerifiedProductImage,
  verifyProductImage,
} from './product-upload';
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
  async removeProduct(id: string) {
    return this.db.transaction(async (manager) => {
      const products = manager.getRepository(Product);
      const product = await products.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!product) throw new NotFoundException('Изделие не найдено.');

      // Заявки содержат снимок изделия на момент отправки и должны остаться
      // доступными владельцу. Избранное таких снимков не имеет — удаляем его.
      await manager.getRepository(Favorite).delete({ productId: id });
      await products.remove(product);
      return { deleted: true };
    });
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
  async image(id: string, admin = false) {
    const query = this.db
      .getRepository(ProductImage)
      .createQueryBuilder('image')
      .innerJoin('image.product', 'product')
      .addSelect('image.data')
      .where('image.id = :id', { id });
    if (!admin) {
      query.andWhere('product.active = true');
      if (process.env.NODE_ENV === 'production')
        query.andWhere('product.isDemo = false');
    }
    const image = await query.getOne();
    if (!image) throw new NotFoundException('Фотография не найдена.');
    return image;
  }

  async saveProduct(
    dto: ProductDto,
    id?: string,
    files: ProductImageUpload[] = [],
  ) {
    if (
      files.length > MAX_PRODUCT_IMAGES ||
      dto.images.length > MAX_PRODUCT_IMAGES
    )
      throw new BadRequestException(
        'Для изделия можно сохранить до 8 фотографий.',
      );
    const uploadRefs = dto.images.filter((path) => path.startsWith('upload:'));
    if (
      new Set(dto.images).size !== dto.images.length ||
      uploadRefs.length !== files.length ||
      files.some((_, i) => !uploadRefs.includes('upload:' + i))
    )
      throw new BadRequestException(
        'Список фотографий не соответствует загруженным файлам.',
      );
    const uploaded: Array<VerifiedProductImage & { id: string }> = [];
    for (const file of files)
      uploaded.push({ id: randomUUID(), ...(await verifyProductImage(file)) });
    try {
      return await this.db.transaction(async (m) => {
        const repo = m.getRepository(Product);
        const existing = id
          ? await repo.findOne({
              where: { id },
              lock: { mode: 'pessimistic_write' },
            })
          : null;
        if (id && !existing) throw new NotFoundException('Изделие не найдено.');
        const imageRepo = m.getRepository(ProductImage);
        const currentImages = id
          ? await imageRepo.findBy({ productId: id })
          : [];
        const keptPaths = dto.images.filter((path) =>
          path.startsWith('/shop/images/'),
        );
        if (
          keptPaths.some(
            (path) =>
              !currentImages.some(
                (image) => path === '/shop/images/' + image.id,
              ),
          )
        )
          throw new BadRequestException(
            'Фотография не принадлежит этому изделию или уже удалена. Обновите карточку.',
          );
        const images = dto.images.map((path) =>
          path.startsWith('upload:')
            ? '/shop/images/' + uploaded[Number(path.slice(7))].id
            : path,
        );
        const productId = id ?? randomUUID();
        const saved = await repo.save(
          repo.create({ ...dto, id: productId, images }),
        );
        if (uploaded.length)
          await imageRepo.insert(
            uploaded.map((image) => ({ ...image, productId })),
          );
        const removed = currentImages
          .filter((image) => !keptPaths.includes('/shop/images/' + image.id))
          .map((image) => image.id);
        if (removed.length)
          await imageRepo.delete({ id: In(removed), productId });
        return saved;
      });
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
