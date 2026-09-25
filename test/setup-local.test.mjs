import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(t, content) {
  const directory = mkdtempSync(join(tmpdir(), 'stitches-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync(join(root, '.env.example'), join(directory, '.env.example'));
  if (content !== undefined) writeFileSync(join(directory, '.env'), content);
  return {
    directory,
    read: () => readFileSync(join(directory, '.env'), 'utf8'),
    run: (...args) =>
      spawnSync(
        process.execPath,
        [join(root, 'scripts/setup-local.mjs'), ...args],
        {
          cwd: directory,
          encoding: 'utf8',
        },
      ),
  };
}

test('new setup creates independent secrets and preserves them on a second run', (t) => {
  const local = fixture(t);
  assert.equal(local.run().status, 0);
  const original = local.read();
  const config = parse(original);
  const secrets = [
    config.JWT_ACCESS_SECRET,
    config.JWT_REFRESH_SECRET,
    config.INITIAL_ADMIN_PASSWORD,
  ];
  assert.equal(new Set(secrets).size, 3);
  for (const secret of secrets) assert.match(secret, /^[a-f0-9]{96}$/);
  const repeat = local.run();
  assert.equal(repeat.status, 0);
  assert.equal(local.read(), original);
  for (const secret of secrets) assert.ok(!repeat.stdout.includes(secret));
});

const legacy =
  [
    "NODE_ENV='development'",
    "DB_HOST='localhost'",
    'DB_PORT=5432',
    "DB_USERNAME='local_owner'",
    "DB_NAME='existing_data'",
    "DB_PASSWORD='keep-this-password'",
    "REDIS_HOST='localhost'",
    'REDIS_PORT=6379',
    "SMTP_HOST='localhost'",
    'SMTP_PORT=1025',
    "JWT_ACCESS_SECRET='keep-access-secret'",
    "JWT_REFRESH_SECRET='keep-refresh-secret'",
    "INITIAL_ADMIN_PASSWORD='keep-admin-password'",
    '# keep this comment',
  ].join('\r\n') + '\r\n';

test('existing env is unchanged without the repair flag', (t) => {
  const local = fixture(t, legacy);
  assert.equal(local.run().status, 0);
  assert.equal(local.read(), legacy);
});

test('repair updates legacy CRLF endpoints without changing credentials or regenerating secrets', (t) => {
  const local = fixture(t, legacy);
  const result = local.run('--repair-ports');
  assert.equal(result.status, 0, result.stderr);
  const repaired = local.read();
  const before = parse(legacy);
  const after = parse(repaired);
  for (const key of [
    'DB_USERNAME',
    'DB_NAME',
    'DB_PASSWORD',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'INITIAL_ADMIN_PASSWORD',
  ]) {
    assert.equal(after[key], before[key]);
    assert.ok(!result.stdout.includes(before[key]));
  }
  assert.deepEqual(
    [after.DB_PORT, after.REDIS_PORT, after.SMTP_PORT, after.MAILPIT_WEB_PORT],
    ['15432', '16379', '11025', '18025'],
  );
  for (const key of ['DB_HOST', 'REDIS_HOST', 'SMTP_HOST'])
    assert.equal(after[key], '127.0.0.1');
  assert.ok(repaired.includes('# keep this comment\r\n'));
  assert.ok(!/(?<!\r)\n/.test(repaired));
  assert.equal(local.run('--repair-ports').status, 0);
  assert.equal(local.read(), repaired);
});

test('repair preserves explicitly configured nonstandard ports', (t) => {
  const content = legacy
    .replace('DB_PORT=5432', 'DB_PORT=25432')
    .replace('REDIS_PORT=6379', 'REDIS_PORT=26379');
  const local = fixture(t, content);
  assert.equal(local.run('--repair-ports').status, 0);
  const config = parse(local.read());
  assert.equal(config.DB_PORT, '25432');
  assert.equal(config.REDIS_PORT, '26379');
});

test('external SMTP and initial administrator are preserved while local ports are repaired', (t) => {
  const smtp = [
    "SMTP_HOST='smtp.yandex.com'",
    'SMTP_PORT=465',
    'SMTP_SECURE=true',
    "SMTP_USER='synthetic-sender@example.test'",
    "SMTP_FROM='synthetic-sender@example.test'",
    "SMTP_PASS='synthetic-mail-password-$-only'",
    "INITIAL_ADMIN_EMAIL='synthetic-owner@example.test'",
  ].join('\r\n');
  const original =
    legacy.replace(/^SMTP_(?:HOST|PORT)=[^\r\n]*\r?\n/gm, '') + smtp + '\r\n';
  const local = fixture(t, original);
  const result = local.run('--repair-ports');
  assert.equal(result.status, 0, result.stderr);
  const repaired = local.read();
  const before = parse(original);
  const after = parse(repaired);
  assert.equal(after.DB_PORT, '15432');
  assert.equal(after.REDIS_PORT, '16379');
  assert.equal(after.MAILPIT_SMTP_PORT, '11025');
  for (const key of Object.keys(before).filter((key) =>
    /^(SMTP_|INITIAL_ADMIN_|JWT_)/.test(key),
  )) {
    assert.equal(after[key], before[key], key);
  }
  assert.ok(repaired.includes(smtp));
  for (const key of [
    'SMTP_PASS',
    'INITIAL_ADMIN_PASSWORD',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ]) {
    assert.ok(!result.stdout.includes(before[key]));
    assert.ok(!result.stderr.includes(before[key]));
  }
  const backups = readdirSync(local.directory).filter((file) =>
    file.startsWith('.env.backup-'),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    readFileSync(join(local.directory, backups[0]), 'utf8'),
    original,
  );
  assert.equal(
    spawnSync('git', ['check-ignore', '--quiet', '--no-index', backups[0]], {
      cwd: root,
    }).status,
    0,
  );
  assert.equal(local.run('--repair-ports').status, 0);
  assert.equal(local.read(), repaired);
  assert.equal(
    readdirSync(local.directory).filter((file) =>
      file.startsWith('.env.backup-'),
    ).length,
    1,
  );
});

test('local SMTP with a custom port keeps Mailpit connected on that port', (t) => {
  const local = fixture(t, legacy.replace('SMTP_PORT=1025', 'SMTP_PORT=21025'));
  assert.equal(local.run('--repair-ports').status, 0);
  const config = parse(local.read());
  assert.equal(config.SMTP_PORT, '21025');
  assert.equal(config.MAILPIT_SMTP_PORT, '21025');
});

test('repair refuses production and remote service settings without touching env', (t) => {
  for (const content of [
    legacy.replace('development', 'production'),
    legacy.replace("DB_HOST='localhost'", "DB_HOST='db.example.test'"),
  ]) {
    const local = fixture(t, content);
    assert.equal(local.run('--repair-ports').status, 1);
    assert.equal(local.read(), content);
  }
});

const hasCompose =
  spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status ===
  0;
test(
  'Compose follows custom env ports and database credentials',
  { skip: !hasCompose && !process.env.CI },
  (t) => {
    assert.ok(hasCompose, 'Docker Compose must be available in CI');
    const custom = [
      'DB_PORT=25432',
      'REDIS_PORT=26379',
      'SMTP_HOST=smtp.yandex.com',
      'SMTP_PORT=465',
      'SMTP_SECURE=true',
      'MAILPIT_SMTP_PORT=21025',
      'MAILPIT_WEB_PORT=28025',
      'DB_NAME=local_config_test',
      'DB_USERNAME=local_test',
      "DB_PASSWORD='local_test_only'",
    ].join('\n');
    const local = fixture(t, custom);
    const env = { ...process.env };
    for (const key of Object.keys(parse(custom))) delete env[key];
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        'stitches-config-test',
        '--env-file',
        join(local.directory, '.env'),
        '-f',
        join(root, 'docker-compose.yml'),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env },
    );
    assert.equal(result.status, 0, result.stderr);
    const { services } = JSON.parse(result.stdout);
    const ports = [
      services.postgres.ports[0],
      services.redis.ports[0],
      ...services.mailpit.ports,
    ];
    assert.deepEqual(
      ports.map((port) => Number(port.published)),
      [25432, 26379, 21025, 28025],
    );
    assert.deepEqual(
      ports.map((port) => port.target),
      [5432, 6379, 1025, 8025],
    );
    assert.ok(ports.every((port) => port.host_ip === '127.0.0.1'));
    assert.equal(
      services.postgres.environment.POSTGRES_DB,
      'local_config_test',
    );
    assert.equal(services.postgres.environment.POSTGRES_USER, 'local_test');
    assert.equal(
      services.postgres.environment.POSTGRES_PASSWORD,
      'local_test_only',
    );
  },
);
