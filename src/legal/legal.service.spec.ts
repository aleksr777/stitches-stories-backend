import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LegalService, canonical, digest } from './legal.service';

describe('Legal document acceptance', () => {
  const service = new LegalService({} as DataSource);
  const account = service.get('pd-account');
  const terms = service.get('account-terms');
  it('rejects missing, combined, duplicate and obsolete confirmations', () => {
    for (const refs of [
      [account],
      [account, account],
      [{ ...account, sha256: '0'.repeat(64) }, terms],
      [{ ...account, version: 'old' }, terms],
    ]) {
      expect(() =>
        service.assertReferences(refs, ['pd-account', 'account-terms']),
      ).toThrow(ConflictException);
    }
    expect(
      service.assertReferences(
        [account, terms],
        ['pd-account', 'account-terms'],
      ),
    ).toHaveLength(2);
  });
  it('keeps archived content hashes reproducible', () => {
    for (const document of service.list()) {
      const { sha256, ...body } = document;
      expect(digest(canonical(body))).toBe(sha256);
    }
  });
  it('refuses production startup with draft legal documents', async () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(service.onModuleInit()).rejects.toThrow(
        'Publish complete legal documents',
      );
    } finally {
      process.env.NODE_ENV = prior;
    }
  });
});
