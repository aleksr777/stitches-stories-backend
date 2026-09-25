import { LegalService } from '../legal/legal.service';
import {
  SocialIdentity,
  SocialIdentityRef,
} from './entities/social-identity.entity';
import { RegistrationDetails } from '../legal/legal.types';
import { HttpException, Injectable, ConflictException } from '@nestjs/common';
import { Repository, DataSource, QueryFailedError } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { TokensService } from './tokens.service';
import { AuthService } from './auth.service';
import { HashService } from '../common/hash-service/hash.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { MailService } from '../common/mail-service/mail.service';
import { EnvService } from '../common/env-service/env.service';
import { RedisService } from '../common/redis-service/redis.service';
import { NicknameGeneratorService } from '../common/nickname-generator-service/nickname-generator.service';
import { User } from '../users/entities/user.entity';
import { ID } from '../common/constants/user-select-fields.constants';
import { TokenType } from '../common/types/token-type.type';

const REGISTRATION_LOCKOUT_PREFIX = 'registration:lockout:';
const REGISTRATION_ACTIVE_PREFIX = 'register:active:';
const REGISTRATION_CODE_PREFIX = 'register:';
const REGISTRATION_LOCKOUT_MESSAGE =
  'Registration is temporarily locked after too many incorrect confirmation codes.';

@Injectable()
export class RegistrationService {
  config: any;
  private readonly frontendUrl: string;
  private readonly registrationExpiresIn: number;
  private readonly registrationVerificationLockout: number;

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly tokensService: TokensService,
    private readonly hashService: HashService,
    private readonly errorsService: ErrorsService,
    private readonly mailService: MailService,
    private readonly envService: EnvService,
    private readonly redisService: RedisService,
    private readonly nicknameGeneratorService: NicknameGeneratorService,
    private readonly legal: LegalService,
  ) {
    this.frontendUrl = this.envService.get('FRONTEND_URL');
    this.registrationExpiresIn =
      this.envService.get('REGISTRATION_TOKEN_EXPIRES_IN', 'number') / 60;
    this.registrationVerificationLockout = this.envService.get(
      'REGISTRATION_VERIFICATION_LOCKOUT',
      'number',
    );
  }

  private getLockoutKey(email: string) {
    return `${REGISTRATION_LOCKOUT_PREFIX}${email.trim().toLowerCase()}`;
  }

  private getActiveCodeKey(email: string) {
    return `${REGISTRATION_ACTIVE_PREFIX}${email.trim().toLowerCase()}`;
  }

  private async invalidateActiveCode(email: string) {
    const activeKey = this.getActiveCodeKey(email);
    const activeCode = await this.redisService.get(activeKey);
    if (activeCode) {
      await this.redisService.del(`${REGISTRATION_CODE_PREFIX}${activeCode}`);
    }
    await this.redisService.del(activeKey);
  }

  private async getLockoutSeconds(email: string) {
    const ttl = await this.redisService.ttl(this.getLockoutKey(email));
    return typeof ttl === 'number' && ttl > 0 ? ttl : 0;
  }

  private async assertNotLocked(email: string) {
    const retryAfter = await this.getLockoutSeconds(email);
    if (retryAfter > 0) {
      this.errorsService.tooManyRequests(
        REGISTRATION_LOCKOUT_MESSAGE,
        retryAfter,
      );
    }
  }

  private async rejectInvalidCode(email: string): Promise<never> {
    await this.tokensService.registerVerificationFailure(
      TokenType.REGISTRATION,
      email,
    );
    const attemptsRemaining =
      await this.tokensService.getVerificationAttemptsRemaining(
        TokenType.REGISTRATION,
        email,
      );

    let retryAfter: number | undefined;
    if (attemptsRemaining <= 0) {
      retryAfter = this.registrationVerificationLockout;
      await this.invalidateActiveCode(email);
      await this.redisService.set(this.getLockoutKey(email), '1', {
        EX: retryAfter,
      });
    }

    return this.errorsService.invalidTokenWithAttempts(
      TokenType.REGISTRATION,
      attemptsRemaining,
      retryAfter,
    );
  }

  private getRequestResponse(retryAfter: number) {
    return {
      message: 'If the email exists, we’ve sent you a code.',
      retry_after: retryAfter,
      max_attempts: this.tokensService.getVerificationAttemptLimit(
        TokenType.REGISTRATION,
      ),
    };
  }

  private async sendExistingAccountNotice(email: string) {
    const resetUrl = `${this.frontendUrl}/auth/password-reset`;
    const text = `Hi, this is an automated message, please do not reply! It looks like there is already an account associated with this email address. If you’ve forgotten your password, you can reset it by using the link below: ${resetUrl}`;
    const html = `
      <p style="font-weight: bold; font-size: 17px;">Hi, this is an automated message, please do not reply!</p>
      <p style="font-weight: bold; font-size: 17px;">It looks like there is already an account associated with this email address.</p>
      <p style="font-weight: bold; font-size: 17px;">If you’ve forgotten your password, you can reset it by using the link below:</p>
      <p style="font-weight: bold; font-size: 17px;"><a href="${resetUrl}" style="font-weight: bold;">${resetUrl}</a></p>
      <p style="font-weight: bold; font-size: 17px;">If you didn’t request this, you can safely ignore this email.</p>`;
    await this.mailService.send(email, 'Password recovery', text, html);
  }

  private async sendRegistrationCode(email: string, code: string) {
    const text = `Hi, this is an automated message, please do not reply! You can confirm your registration by using the code below (within ${this.registrationExpiresIn} min): ${code}`;
    const html = `
      <p style="font-weight: bold; font-size: 17px;">Hi, this is an automated message, please do not reply!</p>
      <p style="font-weight: bold; font-size: 17px;">You can confirm your registration by using the code below (within ${this.registrationExpiresIn} min):</p>
      <p style="font-weight: bold; font-size: 30px;">${code}</p>
      <p style="font-weight: bold; font-size: 17px;">If you didn’t request this, you can safely ignore this email.</p>`;
    await this.mailService.send(email, 'Confirm registration', text, html);
  }

  async request(
    email: string,
    password: string,
    registration: RegistrationDetails,
    socialIdentity?: SocialIdentityRef,
  ) {
    this.legal.assertReferences(registration.documents, [
      'pd-account',
      'account-terms',
    ]);
    const normalizedEmail = email.trim().toLowerCase();
    this.mailService.validateNotServiceEmail(normalizedEmail);
    await this.assertNotLocked(normalizedEmail);
    const retryAfter = await this.tokensService.reserveVerificationCodeRequest(
      TokenType.REGISTRATION,
      normalizedEmail,
    );
    let issuedCode: string | undefined;

    try {
      const user = await this.usersRepository.findOne({
        where: { email: normalizedEmail },
        select: [ID],
      });

      if (user) {
        await this.sendExistingAccountNotice(normalizedEmail);
      } else {
        const hashedPassword = await this.hashService.hash(password);
        issuedCode = await this.tokensService.getRegistrationCode({
          email: normalizedEmail,
          password: hashedPassword,
          registration,
          socialIdentity,
        });
        await this.sendRegistrationCode(normalizedEmail, issuedCode);
        await this.tokensService.clearVerificationFailures(
          TokenType.REGISTRATION,
          normalizedEmail,
        );
      }

      return this.getRequestResponse(retryAfter);
    } catch (err: unknown) {
      if (issuedCode) {
        await this.tokensService
          .deleteRegistrationCode(issuedCode, normalizedEmail)
          .catch(() => undefined);
      }
      await this.tokensService
        .releaseVerificationCodeRequest(TokenType.REGISTRATION, normalizedEmail)
        .catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  async resend(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    this.mailService.validateNotServiceEmail(normalizedEmail);
    await this.assertNotLocked(normalizedEmail);
    const retryAfter = await this.tokensService.reserveVerificationCodeRequest(
      TokenType.REGISTRATION,
      normalizedEmail,
    );
    let issuedCode: string | undefined;

    try {
      const active =
        await this.tokensService.getActiveRegistrationData(normalizedEmail);
      if (active) {
        issuedCode = await this.tokensService.getRegistrationCode(active.data);
        await this.sendRegistrationCode(normalizedEmail, issuedCode);
        await this.tokensService.clearVerificationFailures(
          TokenType.REGISTRATION,
          normalizedEmail,
        );
      } else {
        const user = await this.usersRepository.findOne({
          where: { email: normalizedEmail },
          select: [ID],
        });
        if (user) await this.sendExistingAccountNotice(normalizedEmail);
      }

      return this.getRequestResponse(retryAfter);
    } catch (err: unknown) {
      if (issuedCode) {
        await this.tokensService
          .deleteRegistrationCode(issuedCode, normalizedEmail)
          .catch(() => undefined);
      }
      await this.tokensService
        .releaseVerificationCodeRequest(TokenType.REGISTRATION, normalizedEmail)
        .catch(() => undefined);
      if (err instanceof HttpException) throw err;
      this.errorsService.default(err);
    }
  }

  async confirm(code: string, email: string) {
    const attemptSubject = email.trim().toLowerCase();
    await this.assertNotLocked(attemptSubject);
    await this.tokensService.assertVerificationAttemptsAvailable(
      TokenType.REGISTRATION,
      attemptSubject,
    );

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const data = await this.tokensService.consumeRegistrationCode(
        attemptSubject,
        code,
      );
      if (!data || data.email.trim().toLowerCase() !== attemptSubject) {
        return await this.rejectInvalidCode(attemptSubject);
      }

      if (!data.registration)
        throw new ConflictException(
          'Подтвердите документы и запросите новый код регистрации.',
        );
      this.legal.assertReferences(data.registration.documents, [
        'pd-account',
        'account-terms',
      ]);
      this.mailService.validateNotServiceEmail(data.email);
      let nickname: string;
      let attempts = 0;
      const maxAttempts = 100;
      do {
        if (attempts >= maxAttempts) {
          this.errorsService.default(
            null,
            `Unable to generate unique nickname after ${maxAttempts} attempts`,
          );
        }
        nickname = this.nicknameGeneratorService.get();
        attempts++;
      } while (await qr.manager.findOne(User, { where: { nickname } }));
      const newUser = qr.manager.create(User, {
        email: data.email,
        password: data.password,
        name: data.registration.name,
        nickname,
      });
      await qr.manager.save(User, newUser);
      if (data.socialIdentity) {
        await qr.manager.save(
          SocialIdentity,
          qr.manager.create(SocialIdentity, {
            ...data.socialIdentity,
            userId: newUser.id,
          }),
        );
      }
      await this.legal.record(
        qr.manager,
        data.registration.documents,
        ['pd-account', 'account-terms'],
        {
          userId: newUser.id,
          source: 'registration',
          verification: data.socialIdentity
            ? `${data.socialIdentity.provider}+email-code`
            : 'email-code',
        },
      );
      await qr.commitTransaction();
      await this.tokensService.clearVerificationFailures(
        TokenType.REGISTRATION,
        attemptSubject,
      );
      await this.redisService
        .del(this.getLockoutKey(attemptSubject))
        .catch(() => undefined);
      return this.authService.login(newUser.id);
    } catch (err: unknown) {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      if (err instanceof QueryFailedError) {
        // Driver errors may contain email, password hashes and external IDs.
        throw new ConflictException(
          'Не удалось создать аккаунт. Начните регистрацию заново или войдите в существующий аккаунт.',
        );
      }
      this.errorsService.confirmRegistration(err);
    } finally {
      await qr.release();
    }
  }
}
