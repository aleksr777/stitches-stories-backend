import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
assert.equal((await request('/journal/admin/posts')).status, 401);
assert.equal((await request('/journal/posts')).status, 200);
assert.deepEqual((await request('/journal/posts')).data.items, []);
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
assert.equal(
  (await request('/journal/admin/config', undefined, login.data.access_token))
    .status,
  200,
);
assert(admin.data.some((r) => r.id === first.data.id));
console.log(
  'Application readiness, catalog, consent validation, price checks, request idempotency and administrator access passed.',
);
