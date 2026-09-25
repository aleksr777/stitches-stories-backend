import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { AuthSession } from '../src/auth/entities/auth-session.entity';
import { SocialIdentity } from '../src/auth/entities/social-identity.entity';
import { LegalDocumentEntity, ConsentEvent } from '../src/legal/legal.entities';
import { LegalService } from '../src/legal/legal.service';
import { SocialAccountService } from '../src/auth/social/social-account.service';
import { RegistrationService } from '../src/auth/registration.service';
import { createCredentialFixture, CODE } from './helpers/credential-fixture';
import { Role } from '../src/common/types/role.enum';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Social account persistence in PostgreSQL',
  () => {
    const schema = 'social_test_' + randomUUID().replace(/-/g, '');
    let control: DataSource, db: DataSource;
    let fixture: Awaited<ReturnType<typeof createCredentialFixture>>;
    let accounts: SocialAccountService;
    beforeAll(async () => {
      control = await new DataSource({ type: 'postgres', url }).initialize();
      await control.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        type: 'postgres',
        url,
        schema,
        entities: [
          User,
          AuthSession,
          SocialIdentity,
          LegalDocumentEntity,
          ConsentEvent,
        ],
        synchronize: true,
      }).initialize();
      await new LegalService(db).onModuleInit();
    });
    beforeEach(async () => {
      fixture = await createCredentialFixture(db);
      accounts = new SocialAccountService(
        db,
        fixture.auth,
        {} as RegistrationService,
      );
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (control?.isInitialized) {
        await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await control.destroy();
      }
    });
    it('creates account, provider binding and document confirmations atomically', async () => {
      const legal = new LegalService(db);
      const email = randomUUID() + '@example.test';
      const identity = { provider: 'yandex' as const, subject: randomUUID() };
      fixture.tokenMocks.consumeRegistrationCode.mockResolvedValue({
        email,
        password: fixture.user.password,
        registration: {
          name: 'Тестовый покупатель',
          documents: [legal.get('pd-account'), legal.get('account-terms')],
        },
        socialIdentity: identity,
      });
      await fixture.authController.confirmRegistration({ email, code: CODE }, {
        cookie: jest.fn(),
      } as never);
      const user = await db.getRepository(User).findOneByOrFail({ email });
      expect((await accounts.find(identity))?.userId).toBe(user.id);
      expect(
        await db
          .getRepository(ConsentEvent)
          .countBy({ userId: user.id, verification: 'yandex+email-code' }),
      ).toBe(2);
      const otherEmail = randomUUID() + '@example.test';
      fixture.tokenMocks.consumeRegistrationCode.mockResolvedValue({
        email: otherEmail,
        password: fixture.user.password,
        registration: {
          name: 'Другой покупатель',
          documents: [legal.get('pd-account'), legal.get('account-terms')],
        },
        socialIdentity: identity,
      });
      await expect(
        fixture.authController.confirmRegistration(
          { email: otherEmail, code: CODE },
          { cookie: jest.fn() } as never,
        ),
      ).rejects.toThrow();
      expect(
        await db.getRepository(User).findOneBy({ email: otherEmail }),
      ).toBeNull();
    });
    it('does not merge identities, enforces blocking and owner restrictions, and cascades deletion', async () => {
      const identity = { provider: 'vk' as const, subject: randomUUID() };
      await accounts.link(identity, fixture.user);
      expect((await accounts.login(identity)).id).toBe(fixture.user.id);
      const other = await db.getRepository(User).save({
        email: randomUUID() + '@example.test',
        password: fixture.user.password,
      });
      await expect(accounts.link(identity, other)).rejects.toThrow();
      await db
        .getRepository(User)
        .update(fixture.user.id, { is_blocked: true });
      await expect(accounts.login(identity)).rejects.toThrow();
      await db
        .getRepository(User)
        .update(fixture.user.id, { is_blocked: false, role: Role.ADMIN });
      await expect(accounts.login(identity)).rejects.toThrow();
      await expect(
        accounts.link(
          { provider: 'yandex', subject: randomUUID() },
          fixture.user,
        ),
      ).rejects.toThrow();
      await db.getRepository(User).delete(fixture.user.id);
      expect(await accounts.find(identity)).toBeNull();
    });
  },
);
