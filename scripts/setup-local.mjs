import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--repair-ports')) {
  console.error('Использование: npm run setup:local [-- --repair-ports]');
  process.exit(1);
}

function repairLocalPorts() {
  let text = readFileSync('.env', 'utf8');
  const config = parse(text);
  const hosts = ['DB_HOST', 'REDIS_HOST', 'SMTP_HOST'];
  if (
    config.NODE_ENV !== 'development' ||
    hosts.some(
      (key) =>
        config[key] && !['localhost', '127.0.0.1', '::1'].includes(config[key]),
    )
  ) {
    console.error(
      '--repair-ports предназначен только для development с локальными сервисами. .env не изменён.',
    );
    process.exit(1);
  }

  const replacements = {
    DB_HOST: ['localhost', '::1', '127.0.0.1'],
    REDIS_HOST: ['localhost', '::1', '127.0.0.1'],
    SMTP_HOST: ['localhost', '::1', '127.0.0.1'],
    DB_PORT: ['5432', '15432'],
    REDIS_PORT: ['6379', '16379'],
    SMTP_PORT: ['1025', '11025'],
    MAILPIT_WEB_PORT: ['8025', '18025'],
  };
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const changed = [];
  for (const [key, values] of Object.entries(replacements)) {
    const value = values.at(-1);
    if (config[key] === value) continue;
    // Preserve any deliberately configured nonstandard port.
    if (config[key] && !values.includes(config[key])) continue;
    const pattern = new RegExp(
      `^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`,
      'gm',
    );
    if (pattern.test(text)) text = text.replace(pattern, `${key}=${value}`);
    else
      text += `${text.endsWith('\n') ? '' : newline}${key}=${value}${newline}`;
    changed.push(`${key}=${value}`);
  }
  if (!changed.length) {
    console.log('Локальные порты уже настроены; .env не изменён.');
    return;
  }
  writeFileSync('.env', text, { mode: 0o600 });
  console.log(`Обновлены локальные адреса и порты: ${changed.join(', ')}.`);
  console.log(
    'Пароли и JWT-секреты сохранены. Выполните docker compose up -d --wait.',
  );
}

if (existsSync('.env')) {
  if (args.includes('--repair-ports')) {
    repairLocalPorts();
    process.exit(0);
  }
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
