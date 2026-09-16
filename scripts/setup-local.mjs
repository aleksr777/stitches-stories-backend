import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--repair-ports')) {
  console.error('Использование: npm run setup:local [-- --repair-ports]');
  process.exit(1);
}

function requireDevelopment(config) {
  if (config.NODE_ENV !== 'development') {
    console.error(
      'NODE_ENV в .env должен быть development для локальной настройки. .env не изменён.',
    );
    process.exit(1);
  }
}

function setValues(text, values) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(
      `^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`,
      'gm',
    );
    if (pattern.test(text)) text = text.replace(pattern, `${key}=${value}`);
    else
      text += `${text.endsWith('\n') ? '' : newline}${key}=${value}${newline}`;
  }
  return text;
}

function repairLocalPorts() {
  const original = readFileSync('.env', 'utf8');
  let text = original;
  const config = parse(text);
  requireDevelopment(config);
  const hosts = ['DB_HOST', 'REDIS_HOST'];
  const remoteHosts = hosts.filter(
    (key) =>
      config[key] && !['localhost', '127.0.0.1', '::1'].includes(config[key]),
  );
  if (remoteHosts.length) {
    console.error(
      `Нелокальные настройки: ${remoteHosts.join(', ')}. --repair-ports меняет только локальные PostgreSQL и Redis. .env не изменён.`,
    );
    process.exit(1);
  }

  const replacements = {
    DB_HOST: ['localhost', '::1', '127.0.0.1'],
    REDIS_HOST: ['localhost', '::1', '127.0.0.1'],
    DB_PORT: ['5432', '15432'],
    REDIS_PORT: ['6379', '16379'],
    MAILPIT_SMTP_PORT: ['11025'],
    MAILPIT_WEB_PORT: ['8025', '18025'],
  };
  // External SMTP, its credentials and administrator settings are independent
  // of the local database ports and must stay unchanged.
  const localMailpit =
    ['localhost', '127.0.0.1', '::1'].includes(config.SMTP_HOST) &&
    !['true', '1'].includes((config.SMTP_SECURE ?? '').toLowerCase()) &&
    !config.SMTP_USER &&
    !config.SMTP_PASS;
  if (localMailpit) {
    replacements.SMTP_HOST = ['localhost', '::1', '127.0.0.1'];
    replacements.SMTP_PORT = ['1025', '11025'];
    replacements.MAILPIT_SMTP_PORT = [
      config.SMTP_PORT && config.SMTP_PORT !== '1025'
        ? config.SMTP_PORT
        : '11025',
    ];
  }
  const changed = [];
  for (const [key, values] of Object.entries(replacements)) {
    const value = values.at(-1);
    if (config[key] === value) continue;
    // Preserve any deliberately configured nonstandard port.
    if (config[key] && !values.includes(config[key])) continue;
    text = setValues(text, { [key]: value });
    changed.push(`${key}=${value}`);
  }
  if (!changed.length) {
    console.log('Локальные порты уже настроены; .env не изменён.');
    return;
  }
  const backup = `.env.backup-${Date.now()}-${randomBytes(4).toString('hex')}`;
  writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  writeFileSync('.env', text, { mode: 0o600 });
  console.log(`Исходные настройки сохранены в ${backup} (исключён из Git).`);
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
