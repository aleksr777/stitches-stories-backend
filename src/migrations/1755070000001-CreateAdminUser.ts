import { MigrationInterface, QueryRunner } from 'typeorm';
import { HashService } from '../common/hash-service/hash.service';
import { NicknameGeneratorService } from '../common/nickname-generator-service/nickname-generator.service';
import { Role } from '../common/types/role.enum';

export class CreateAdminUser1755070000001 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    const email = process.env.INITIAL_ADMIN_EMAIL;
    const plainPass = process.env.INITIAL_ADMIN_PASSWORD;
    const baseNickname = process.env.INITIAL_ADMIN_NICKNAME || 'admin';

    if (!email || !plainPass) {
      throw new Error(
        'INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD is not defined',
      );
    }

    // Check for existing user
    const existingUnknown: unknown = await q.query(
      `SELECT id FROM "user" WHERE email = $1`,
      [email],
    );
    if (!Array.isArray(existingUnknown)) {
      throw new Error('Unexpected query result for existing user check');
    }
    const existing = existingUnknown as Array<{ id: number }>;

    if (existing.length > 0) {
      await q.query(`UPDATE "user" SET role = $1 WHERE email = $2`, [
        Role.ADMIN,
        email,
      ]);
      return;
    }

    // Generate a unique nickname
    const nicknameGenerator = new NicknameGeneratorService();
    let nickname = baseNickname;
    let isNicknameUnique = false;

    for (let i = 0; i < 50 && !isNicknameUnique; i++) {
      const nickUnknown: unknown = await q.query(
        `SELECT 1 AS exists FROM "user" WHERE nickname = $1 LIMIT 1`,
        [nickname],
      );
      if (!Array.isArray(nickUnknown)) {
        throw new Error('Unexpected query result for nickname check');
      }
      const nickTaken = nickUnknown as Array<{ exists: number }>;

      if (nickTaken.length === 0) {
        isNicknameUnique = true;
      } else {
        nickname = nicknameGenerator.get();
      }
    }

    if (!isNicknameUnique) {
      throw new Error('Failed to generate unique nickname after 50 attempts');
    }

    const hashService = new HashService();
    const hashedPass = await hashService.hash(plainPass);

    await q.query(
      `INSERT INTO "user" (email, password, nickname, role)
       VALUES ($1, $2, $3, $4)`,
      [email, hashedPass, nickname, Role.ADMIN],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const email = process.env.INITIAL_ADMIN_EMAIL;
    if (!email) throw new Error('INITIAL_ADMIN_EMAIL is not defined');
    await q.query(`UPDATE "user" SET role = $1 WHERE email = $2`, [
      Role.USER,
      email,
    ]);
  }
}
