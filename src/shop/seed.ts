import dataSource from '../../data-source';
import { Product } from './shop.entities';

async function seed() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Demo seed is disabled in production');
  await dataSource.initialize();
  try {
    const rows = [
      ['quiet-garden', 'Брелок «Тихий сад»', 'keychains', 1200],
      ['wildflowers', 'Обложка «Полевые цветы»', 'covers', 2400],
      ['warm-day', 'Брелок «Тёплый день»', 'keychains', 1400],
      ['leaves', 'Обложка «Листья»', 'covers', 2500],
    ] as const;
    for (const [slug, name, category, priceRub] of rows) {
      await dataSource
        .getRepository(Product)
        .createQueryBuilder()
        .insert()
        .values({
          slug,
          name,
          category,
          priceRub,
          description:
            'Демонстрационная карточка для проверки магазина. Описание, материалы и размеры необходимо заменить данными настоящего изделия.',
          materials: 'Уточняется перед публикацией',
          dimensions: 'Уточняется',
          productionTime: 'По согласованию с мастером',
          images: [],
          stock: 10,
          featured: true,
          active: true,
          isDemo: true,
        })
        .orIgnore()
        .execute();
    }
    console.log(
      'Добавлены демонстрационные изделия; существующие карточки сохранены.',
    );
  } finally {
    await dataSource.destroy();
  }
}
void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
