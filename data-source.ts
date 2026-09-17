import { shopEntities } from './src/shop/shop.entities';
import { LegalDocumentEntity, ConsentEvent } from './src/legal/legal.entities';
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { SecurityAuditEvent } from './src/audit/security-audit-event.entity';
import { AuthSession } from './src/auth/entities/auth-session.entity';
import { User } from './src/users/entities/user.entity';

const sslEnabled = ['true', '1'].includes(
  (process.env.DB_SSL ?? '').toLowerCase(),
);
const rejectUnauthorized = !['false', '0'].includes(
  (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'true').toLowerCase(),
);

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  entities: [
    User,
    AuthSession,
    SecurityAuditEvent,
    ...shopEntities,
    LegalDocumentEntity,
    ConsentEvent,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  ssl: sslEnabled ? { rejectUnauthorized } : false,
});

export default dataSource;
