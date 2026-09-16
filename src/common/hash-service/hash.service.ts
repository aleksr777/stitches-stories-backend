import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class HashService {
  private readonly saltRounds = 11;

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async compare(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  compareToken(token: string, hashedToken: string): boolean {
    const actual = Buffer.from(this.hashToken(token), 'hex');
    const expected = Buffer.from(hashedToken, 'hex');

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
