import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
const base = process.env.SHOP_API_URL ?? 'http://127.0.0.1:5174/api';
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    if ((await fetch(base + '/health/ready')).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert(ready, 'Application did not become ready');
const request = async (path, body, token) => {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  return { status: response.status, data };
};
const products = (await request('/shop/products')).data;
assert(
  products.length > 0,
  'Run seed:demo in a non-production test environment',
);
const docs = (await request('/legal/documents')).data;
assert.equal(docs.length, 11);
assert.equal((await request('/shop/admin/requests')).status, 401);
assert.equal((await request('/journal/posts')).status, 404);
assert.equal((await request('/journal/admin/import', {})).status, 404);
assert.equal(
  (
    await request('/auth/registration/request', {
      email: 'smoke@example.test',
      password: 'smoke-only-password',
    })
  ).status,
  400,
);
const p = products[0];
const offer = docs.find((d) => d.id === 'offer');
const body = {
  requestKey: randomUUID(),
  name: 'Тестовая заявка',
  email: 'smoke@example.test',
  city: 'Тестовый город',
  items: [{ productId: p.id, quantity: 1, expectedPriceRub: p.priceRub }],
  document: { id: offer.id, version: offer.version, sha256: offer.sha256 },
};
const [first, second] = await Promise.all([
  request('/shop/requests', body),
  request('/shop/requests', body),
]);
assert.equal(first.status, 201);
assert.equal(second.status, 201);
assert.equal(first.data.id, second.data.id);
const badPrice = await request('/shop/requests', {
  ...body,
  requestKey: randomUUID(),
  items: [{ ...body.items[0], expectedPriceRub: p.priceRub + 1 }],
});
assert.equal(badPrice.status, 409);
const login = await request('/auth/login', {
  email: process.env.INITIAL_ADMIN_EMAIL,
  password: process.env.INITIAL_ADMIN_PASSWORD,
});
assert.equal(login.status, 201);
const admin = await request(
  '/shop/admin/requests',
  undefined,
  login.data.access_token,
);
assert.equal(admin.status, 200);
assert(admin.data.some((r) => r.id === first.data.id));
const photoBytes = await sharp({
  create: { width: 3, height: 4, channels: 3, background: '#d9b7b1' },
})
  .png()
  .toBuffer();
const photoProduct = {
  slug: 'smoke-photo-' + randomUUID(),
  name: 'Тестовая фотография',
  category: 'covers',
  priceRub: 1000,
  description: 'Изделие для проверки загрузки фотографии',
  materials: 'Хлопок',
  dimensions: '10 × 15 см',
  productionTime: 'По согласованию',
  images: ['upload:0'],
  stock: 1,
  featured: false,
  active: true,
  isDemo: true,
};
const savePhotoProduct = async (data, id) => {
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  if (!id)
    form.append(
      'files',
      new Blob([photoBytes], { type: 'image/png' }),
      'test.png',
    );
  const result = await fetch(
    base + '/shop/admin/products' + (id ? '/' + id : ''),
    {
      method: id ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer ' + login.data.access_token },
      body: form,
    },
  );
  assert.equal(result.status, id ? 200 : 201);
  return result.json();
};
const withPhoto = await savePhotoProduct(photoProduct);
assert.match(withPhoto.images[0], /^\/shop\/images\/[0-9a-f-]+$/);
const photoResponse = await fetch(base + withPhoto.images[0]);
assert.equal(photoResponse.status, 200);
assert.equal(photoResponse.headers.get('content-type'), 'image/png');
assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), photoBytes);
const reloaded = await request('/shop/products/' + photoProduct.slug);
assert.deepEqual(reloaded.data.images, withPhoto.images);
await savePhotoProduct(
  { ...photoProduct, active: false, images: withPhoto.images },
  withPhoto.id,
);
assert.equal((await fetch(base + withPhoto.images[0])).status, 404);
const privatePath = withPhoto.images[0].replace('/images/', '/admin/images/');
assert.equal((await fetch(base + privatePath)).status, 401);
assert.equal(
  (
    await fetch(base + privatePath, {
      headers: { Authorization: 'Bearer ' + login.data.access_token },
    })
  ).status,
  200,
);
const deleted = await fetch(base + '/shop/admin/products/' + withPhoto.id, {
  method: 'DELETE',
  headers: { Authorization: 'Bearer ' + login.data.access_token },
});
assert.equal(deleted.status, 200);
assert.deepEqual(await deleted.json(), { deleted: true });
const productsAfterDeletion = await request(
  '/shop/admin/products',
  undefined,
  login.data.access_token,
);
assert.equal(
  productsAfterDeletion.data.some((product) => product.id === withPhoto.id),
  false,
);
assert.equal(
  (await request('/shop/products/' + photoProduct.slug)).status,
  404,
);
assert.equal(
  (
    await fetch(base + privatePath, {
      headers: { Authorization: 'Bearer ' + login.data.access_token },
    })
  ).status,
  404,
);
console.log(
  'Application readiness, catalog, consent validation, price checks, request idempotency, administrator access and product image upload/read/edit/delete passed.',
);
