import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) {
  console.log('.env уже существует; настройки сохранены.');
  process.exit(0);
}
let text = readFileSync('.env.example', 'utf8');
for (const key of [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'INITIAL_ADMIN_PASSWORD',
])
  text = text.replace(
    new RegExp('^' + key + '=.*$', 'm'),
    key + '=' + randomBytes(48).toString('hex'),
  );
writeFileSync('.env', text, { mode: 0o600 });
console.log('Создан локальный .env с независимыми случайными JWT-секретами.');
