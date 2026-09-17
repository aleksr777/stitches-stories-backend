import {
  BadRequestException,
  PayloadTooLargeException,
  ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ProductDto } from './shop.dto';

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_PIXELS = 40_000_000;
export type ProductImageUpload = { buffer: Buffer };
export type VerifiedProductImage = {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
};

// Guards run before this interceptor. Multer uses memory storage; no temp files.
export const ProductFilesInterceptor = FilesInterceptor(
  'files',
  MAX_PRODUCT_IMAGES,
  {
    limits: {
      fileSize: MAX_PRODUCT_IMAGE_BYTES,
      files: MAX_PRODUCT_IMAGES,
      fields: 1,
      fieldSize: 32 * 1024,
      parts: MAX_PRODUCT_IMAGES + 2,
    },
  },
);

const validation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

// JSON clients remain supported. Multipart carries one JSON field, "data", so
// booleans and numbers keep their types rather than relying on string coercion.
export async function parseProductPayload(body: unknown): Promise<ProductDto> {
  let input = body;
  if (body && typeof body === 'object' && 'data' in body) {
    if (Object.keys(body).length !== 1 || typeof body.data !== 'string')
      throw new BadRequestException('Ожидаются данные изделия и фотографии.');
    try {
      input = JSON.parse(body.data) as unknown;
    } catch {
      throw new BadRequestException('Некорректные данные изделия.');
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Некорректные данные изделия.');
  return (await validation.transform(input, {
    type: 'body',
    metatype: ProductDto,
  })) as ProductDto;
}

export async function verifyProductImage(
  file: ProductImageUpload,
): Promise<VerifiedProductImage> {
  const data = file.buffer;
  if (!Buffer.isBuffer(data) || !data.length)
    throw new BadRequestException('Выберите непустую фотографию.');
  if (data.length > MAX_PRODUCT_IMAGE_BYTES)
    throw new PayloadTooLargeException('Размер фотографии превышает 8 МБ.');
  const signature = data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? 'jpeg'
    : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : data.toString('ascii', 0, 4) === 'RIFF' &&
          data.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : null;
  if (!signature)
    throw new BadRequestException(
      'Поддерживаются фотографии JPEG, PNG и WebP.',
    );
  try {
    const image = sharp(data, {
      failOn: 'warning',
      limitInputPixels: MAX_PRODUCT_IMAGE_PIXELS,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== signature ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error('unsupported image');
    // Decode pixels, not just the header, to reject truncated or corrupt uploads.
    await image.stats();
    return {
      data,
      mime: 'image/' + signature,
      width: metadata.width,
      height: metadata.height,
      byteLength: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  } catch {
    throw new BadRequestException(
      'Фотография повреждена или превышает 40 мегапикселей. Выберите статическое изображение JPEG, PNG или WebP.',
    );
  }
}
