import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
const base = process.env.SHOP_API_URL ?? 'http://127.0.0.1:5174/api';
const localMailpitHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const mailpitBase =
  process.env.SMOKE_MAILPIT_URL ??
  `http://127.0.0.1:${process.env.MAILPIT_WEB_PORT ?? '18025'}`;

function isLocalMailpit() {
  return (
    localMailpitHosts.has(process.env.SMTP_HOST ?? '') &&
    !['true', '1'].includes((process.env.SMTP_SECURE ?? '').toLowerCase()) &&
    !process.env.SMTP_USER &&
    !process.env.SMTP_PASS
  );
}

function messageHasRecipient(message, email) {
  return JSON.stringify(message?.To ?? message?.to ?? '')
    .toLowerCase()
    .includes(email.toLowerCase());
}

function extractConfirmationCode(message) {
  const text = [
    message?.Text,
    message?.HTML,
    message?.text,
    message?.html,
    message?.Snippet,
    message?.snippet,
  ]
    .filter((value) => typeof value === 'string')
    .join('\n');
  return text.match(/\b\d{6}\b/)?.[0] ?? null;
}

async function readAdminConfirmationCode(email) {
  assert(
    isLocalMailpit(),
    'Smoke-проверка входа владельца требует локальный Mailpit. Не используйте её с внешним SMTP.',
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${mailpitBase}/api/v1/messages?limit=100`);
      if (response.ok) {
        const payload = await response.json();
        const messages = Array.isArray(payload)
          ? payload
          : Array.isArray(payload.messages)
            ? payload.messages
            : [];
        for (const message of messages) {
          if (
            !messageHasRecipient(message, email) ||
            !String(message.Subject ?? message.subject ?? '').includes(
              'Подтвердите вход владельца',
            )
          )
            continue;
          const code = extractConfirmationCode(message);
          if (code) return code;
          const id = message.ID ?? message.id;
          if (!id) continue;
          const detailResponse = await fetch(
            `${mailpitBase}/api/v1/message/${encodeURIComponent(id)}`,
          );
          if (!detailResponse.ok) continue;
          const detailCode = extractConfirmationCode(
            await detailResponse.json(),
          );
          if (detailCode) return detailCode;
        }
      }
    } catch {
      // Mailpit can become available shortly after the application does.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(
    'Код подтверждения входа владельца не поступил в локальный Mailpit.',
  );
}

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
const categories = (await request('/shop/categories')).data;
assert(categories.some((category) => category.id === 'covers'));
assert(
  products.every(
    (product) =>
      !product.category ||
      categories.some((category) => category.id === product.category),
  ),
);
assert(
  categories.every(
    (category) => !('nameKey' in category) && !('productCount' in category),
  ),
);
assert.equal((await request('/shop/admin/categories')).status, 401);
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
assert.equal(login.data.admin_confirmation_required, true);
const adminConfirmationCode = await readAdminConfirmationCode(
  process.env.INITIAL_ADMIN_EMAIL,
);
const confirmedLogin = await request('/auth/login/admin/confirm', {
  challenge_id: login.data.challenge_id,
  code: adminConfirmationCode,
});
assert.equal(confirmedLogin.status, 201);
assert.equal(typeof confirmedLogin.data.access_token, 'string');
const admin = await request(
  '/shop/admin/requests',
  undefined,
  confirmedLogin.data.access_token,
);
assert.equal(admin.status, 200);
assert(admin.data.some((r) => r.id === first.data.id));
const categoryCreated = await request(
  '/shop/admin/categories',
  {
    name: 'Панно ' + randomUUID(),
  },
  confirmedLogin.data.access_token,
);
assert.equal(categoryCreated.status, 201);
const categoryPath = base + '/shop/admin/categories/' + categoryCreated.data.id;
const categoryHeaders = {
  Authorization: 'Bearer ' + confirmedLogin.data.access_token,
  'Content-Type': 'application/json',
};
const categoryRenamed = await fetch(categoryPath, {
  method: 'PATCH',
  headers: categoryHeaders,
  body: JSON.stringify({ name: 'Картины ' + categoryCreated.data.id }),
});
assert.equal(categoryRenamed.status, 200);
assert.equal((await categoryRenamed.json()).id, categoryCreated.data.id);
const photoBytes = await sharp({
  create: { width: 3, height: 4, channels: 3, background: '#d9b7b1' },
})
  .png()
  .toBuffer();
const photoProduct = {
  slug: 'smoke-photo-' + randomUUID(),
  name: 'Тестовая фотография',
  category: categoryCreated.data.id,
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
      headers: { Authorization: 'Bearer ' + confirmedLogin.data.access_token },
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
assert.equal(
  (await fetch(categoryPath, { method: 'DELETE', headers: categoryHeaders }))
    .status,
  409,
);
const adminCategories = await request(
  '/shop/admin/categories',
  undefined,
  confirmedLogin.data.access_token,
);
assert.equal(
  adminCategories.data.find(
    (category) => category.id === categoryCreated.data.id,
  ).productCount,
  1,
);
const privatePath = withPhoto.images[0].replace('/images/', '/admin/images/');
assert.equal((await fetch(base + privatePath)).status, 401);
assert.equal(
  (
    await fetch(base + privatePath, {
      headers: { Authorization: 'Bearer ' + confirmedLogin.data.access_token },
    })
  ).status,
  200,
);
const deleted = await fetch(base + '/shop/admin/products/' + withPhoto.id, {
  method: 'DELETE',
  headers: { Authorization: 'Bearer ' + confirmedLogin.data.access_token },
});
assert.equal(deleted.status, 200);
assert.deepEqual(await deleted.json(), { deleted: true });
assert.equal(
  (await fetch(categoryPath, { method: 'DELETE', headers: categoryHeaders }))
    .status,
  200,
);
assert.equal(
  (await request('/shop/categories')).data.some(
    (category) => category.id === categoryCreated.data.id,
  ),
  false,
);
const productsAfterDeletion = await request(
  '/shop/admin/products',
  undefined,
  confirmedLogin.data.access_token,
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
      headers: { Authorization: 'Bearer ' + confirmedLogin.data.access_token },
    })
  ).status,
  404,
);
console.log(
  'Application readiness, catalog, consent validation, price checks, request idempotency, administrator access, category management and product image upload/read/edit/delete passed.',
);
