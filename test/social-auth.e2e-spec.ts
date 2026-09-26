import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { AuthSession } from '../src/auth/entities/auth-session.entity';
import { SocialIdentity } from '../src/auth/entities/social-identity.entity';
import { LegalDocumentEntity, ConsentEvent } from '../src/legal/legal.entities';
import { LegalService } from '../src/legal/legal.service';
import { SocialAccountService } from '../src/auth/social/social-account.service';
import { createCredentialFixture, CODE } from './helpers/credential-fixture';
import { Role } from '../src/common/types/role.enum';
import { HashService } from '../src/common/hash-service/hash.service';

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
        new LegalService(db),
        new HashService(),
      );
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (control?.isInitialized) {
        await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await control.destroy();
      }
    });
    it('creates a VK account with available profile fields and documents without merging by email', async () => {
      const legal = new LegalService(db);
      const identity = {
        provider: 'vk' as const,
        subject: randomUUID(),
        profile: {
          name: 'Тестовый покупатель',
          email: fixture.user.email!,
          phone: '+79001234567',
        },
      };
      const refs = [legal.get('pd-account'), legal.get('account-terms')];
      const previousCount = await db.getRepository(User).count();
      const user = await accounts.registerSocial(identity, refs);
      expect(user).toMatchObject({
        email: null,
        contact_email: fixture.user.email,
        name: 'Тестовый покупатель',
        phone_number: '+79001234567',
        sex: null,
        role: Role.USER,
      });
      expect(user.id).not.toBe(fixture.user.id);
      expect((await accounts.find(identity))?.userId).toBe(user.id);
      expect(
        await db
          .getRepository(ConsentEvent)
          .countBy({ userId: user.id, verification: 'vk-oauth' }),
      ).toBe(2);
      await expect(accounts.registerSocial(identity, refs)).rejects.toThrow();
      expect(await db.getRepository(User).count()).toBe(previousCount + 1);
      const missingProfile = await accounts.registerSocial(
        { provider: 'vk', subject: randomUUID() },
        refs,
      );
      expect(missingProfile).toMatchObject({
        email: null,
        contact_email: null,
        name: null,
        phone_number: null,
      });
    });
    it('creates a Yandex account from optional profile details without requiring email or merging by email', async () => {
      const legal = new LegalService(db);
      const identity = {
        provider: 'yandex' as const,
        subject: randomUUID(),
        profile: {
          name: 'Надежда Петрова',
          sex: 'female' as const,
          phone: '+79001234567',
          email: fixture.user.email!,
        },
      };
      const refs = [legal.get('pd-account'), legal.get('account-terms')];
      const user = await accounts.registerSocial(identity, refs);
      expect(user).toMatchObject({
        email: null,
        contact_email: fixture.user.email,
        name: 'Надежда Петрова',
        sex: 'female',
        phone_number: '+79001234567',
        role: Role.USER,
      });
      expect((await accounts.login(identity)).id).toBe(user.id);
      expect((await accounts.find(identity))?.userId).toBe(user.id);
      expect(
        await db.getRepository(ConsentEvent).countBy({
          userId: user.id,
          verification: 'yandex-oauth',
        }),
      ).toBe(2);
      await expect(accounts.registerSocial(identity, refs)).rejects.toThrow();
      const withoutDetails = await accounts.registerSocial(
        { provider: 'yandex', subject: randomUUID() },
        refs,
      );
      expect(withoutDetails).toMatchObject({
        email: null,
        contact_email: null,
        name: null,
      });
    });
    it('changes Yandex contact email only after a code while preserving the login identity', async () => {
      const identity = {
        provider: 'yandex' as const,
        subject: randomUUID(),
        profile: {
          name: 'Надежда Петрова',
          sex: 'female' as const,
          phone: '+79001234567',
          email: 'old@example.test',
        },
      };
      const legal = new LegalService(db);
      const user = await accounts.registerSocial(identity, [
        legal.get('pd-account'),
        legal.get('account-terms'),
      ]);
      const updated = await fixture.usersController.updatePartialUserData(
        {
          name: 'Надежда Иванова',
          phone_number: null,
          sex: null,
        },
        { user } as never,
      );
      expect(updated).toMatchObject({
        email: null,
        name: 'Надежда Иванова',
        contact_email: 'old@example.test',
        phone_number: null,
        sex: null,
      });
      await expect(
        fixture.usersController.updatePartialUserData(
          { contact_email: 'new@example.test' } as never,
          { user } as never,
        ),
      ).rejects.toThrow();
      await fixture.usersController.requestContactEmailChange(
        { new_email: 'new@example.test' },
        { user } as never,
      );
      expect(fixture.sendMail).toHaveBeenCalledWith(
        'new@example.test',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
      expect(
        await fixture.usersController.getCurrentProfile({ user } as never),
      ).toHaveProperty('contact_email', 'old@example.test');
      await expect(
        fixture.usersController.confirmContactEmailChange({ code: '654321' }, {
          user,
        } as never),
      ).rejects.toThrow();
      expect(
        await fixture.usersController.getCurrentProfile({ user } as never),
      ).toHaveProperty('contact_email', 'old@example.test');
      await expect(
        fixture.usersController.confirmUpdateEmail({ code: CODE }, {
          user,
          authSessionId: 'session-id',
        } as never),
      ).rejects.toThrow();
      await fixture.usersController.confirmContactEmailChange({ code: CODE }, {
        user,
        ip: '127.0.0.1',
        get: () => undefined,
      } as never);
      await expect(
        fixture.usersController.confirmContactEmailChange({ code: CODE }, {
          user,
        } as never),
      ).rejects.toThrow();
      expect((await accounts.login(identity)).id).toBe(user.id);
      expect(
        await fixture.usersController.getCurrentProfile({ user } as never),
      ).toMatchObject({
        email: null,
        name: 'Надежда Иванова',
        contact_email: 'new@example.test',
        phone_number: null,
        sex: null,
      });
      expect((await accounts.find(identity))?.userId).toBe(user.id);
    });
    it('removes a contact email only with a code sent to the existing address', async () => {
      const legal = new LegalService(db);
      const user = await accounts.registerSocial(
        {
          provider: 'yandex',
          subject: randomUUID(),
          profile: { email: 'old@example.test' },
        },
        [legal.get('pd-account'), legal.get('account-terms')],
      );
      await fixture.usersController.requestContactEmailChange(
        { new_email: null },
        { user } as never,
      );
      expect(fixture.sendMail).toHaveBeenCalledWith(
        'old@example.test',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
      expect(
        await fixture.usersController.getCurrentProfile({ user } as never),
      ).toHaveProperty('contact_email', 'old@example.test');
      await fixture.usersController.confirmContactEmailChange({ code: CODE }, {
        user,
        ip: '127.0.0.1',
        get: () => undefined,
      } as never);
      expect(
        await fixture.usersController.getCurrentProfile({ user } as never),
      ).toHaveProperty('contact_email', null);
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
