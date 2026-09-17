import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import {
  MAX_PRODUCT_IMAGE_BYTES,
  parseProductPayload,
  verifyProductImage,
} from './product-upload';

const product = {
  slug: 'quiet-garden',
  name: 'Тихий сад',
  category: 'keychains',
  priceRub: 1200,
  description: 'Вышитый брелок из хлопка',
  materials: 'Хлопок',
  dimensions: '5 см',
  productionTime: 'По согласованию',
  images: [],
  stock: 1,
  active: false,
  featured: false,
  isDemo: true,
};

describe('Product upload validation', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'validates %s pixels and keeps the exact original bytes',
    async (format) => {
      const data = await sharp({
        create: { width: 4, height: 5, channels: 3, background: '#d9b7b1' },
      })
        .toFormat(format)
        .toBuffer();
      const result = await verifyProductImage({ buffer: data });
      expect(result.data).toEqual(data);
      expect(result.mime).toBe('image/' + format);
      expect([result.width, result.height, result.byteLength]).toEqual([
        4,
        5,
        data.length,
      ]);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    },
  );
  it('rejects HTML, SVG, empty, truncated and oversized content', async () => {
    for (const data of [
      Buffer.alloc(0),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('<html>not a photo</html>'),
      Buffer.from([255, 216, 255, 0, 1]),
    ])
      await expect(verifyProductImage({ buffer: data })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    await expect(
      verifyProductImage({ buffer: Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1) }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
  it('rejects oversized pixel dimensions even when the compressed file is small', async () => {
    const data = await sharp({
      create: { width: 6500, height: 6500, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    expect(data.length).toBeLessThan(MAX_PRODUCT_IMAGE_BYTES);
    await expect(verifyProductImage({ buffer: data })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('parses multipart JSON without turning false into true and retains JSON API support', async () => {
    expect(
      await parseProductPayload({ data: JSON.stringify(product) }),
    ).toMatchObject({ active: false, featured: false, priceRub: 1200 });
    expect(await parseProductPayload(product)).toMatchObject(product);
  });
  it('rejects malformed payloads, untrusted URLs, duplicate references and unknown fields', async () => {
    for (const body of [
      { data: '{' },
      { data: JSON.stringify(product), extra: 'value' },
      { ...product, images: ['https://other.example/photo.jpg'] },
      { ...product, images: ['upload:0', 'upload:0'] },
      { ...product, active: 'false' },
      { ...product, administratorId: 1 },
      null,
      [],
    ])
      await expect(parseProductPayload(body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
  });
});
