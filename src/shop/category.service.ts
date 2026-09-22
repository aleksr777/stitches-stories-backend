import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { CategoryDto, normalizeCategoryName } from './category.dto';
import { ProductCategory } from './category.entity';
import { Product } from './shop.entities';

@Injectable()
export class CategoryService {
  constructor(private readonly db: DataSource) {}

  list() {
    return this.db.getRepository(ProductCategory).find({
      select: { id: true, name: true },
      order: { name: 'ASC', id: 'ASC' },
    });
  }

  async adminList() {
    const rows = await this.db
      .getRepository(ProductCategory)
      .createQueryBuilder('category')
      .leftJoin(Product, 'product', 'product.category = category.id')
      .select('category.id', 'id')
      .addSelect('category.name', 'name')
      .addSelect('COUNT(product.id)', 'productCount')
      .groupBy('category.id')
      .addGroupBy('category.name')
      .orderBy('category.name', 'ASC')
      .addOrderBy('category.id', 'ASC')
      .getRawMany<{ id: string; name: string; productCount: string }>();
    return rows.map((row) => ({
      ...row,
      productCount: Number(row.productCount),
    }));
  }

  async save(dto: CategoryDto, id?: string) {
    const name = normalizeCategoryName(dto.name);
    if (!name || name.length > 100)
      throw new BadRequestException(
        'Название категории должно содержать от 1 до 100 символов.',
      );
    const data = { name, nameKey: name.toLocaleLowerCase('ru-RU') };
    const repo = this.db.getRepository(ProductCategory);
    try {
      if (id) {
        const result = await repo.update(id, data);
        if (!result.affected)
          throw new NotFoundException('Категория не найдена.');
      } else {
        id = randomUUID();
        await repo.insert({ id, ...data });
      }
      return { id, name };
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23505'
      )
        throw new ConflictException(
          'Категория с таким названием уже существует.',
        );
      throw error;
    }
  }

  async remove(id: string) {
    try {
      // The FK checks ALL products and prevents races with product creation/moves.
      const result = await this.db.getRepository(ProductCategory).delete(id);
      if (!result.affected)
        throw new NotFoundException('Категория не найдена.');
      return { deleted: true };
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23503'
      )
        throw new ConflictException(
          'В категории есть изделия. Сначала перенесите их в другую категорию или удалите.',
        );
      throw error;
    }
  }
}
