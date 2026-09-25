import { MigrationInterface } from 'typeorm';

// Keep the original migration identity for databases that have already run it.
export class FixUserSchema1789412000000 implements MigrationInterface {
  name = 'FixUserSchema1789412000000';

  up(): Promise<void> {
    return Promise.resolve();
  }

  down(): Promise<void> {
    return Promise.resolve();
  }
}
