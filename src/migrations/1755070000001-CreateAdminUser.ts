import { MigrationInterface, QueryRunner } from 'typeorm';
import { HashService } from '../common/hash-service/hash.service';
import { Role } from '../common/types/role.enum';

export class CreateAdminUser1755070000001 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    const email = process.env.INITIAL_ADMIN_EMAIL;
    const plainPass = process.env.INITIAL_ADMIN_PASSWORD;

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

    const hashService = new HashService();
    const hashedPass = await hashService.hash(plainPass);

    await q.query(
      `INSERT INTO "user" (email, password, role)
       VALUES ($1, $2, $3)`,
      [email, hashedPass, Role.ADMIN],
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
