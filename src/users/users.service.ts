import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { HashService } from '../common/hash-service/hash.service';
import { ErrorsService } from '../common/errors-service/errors.service';
import { User } from './entities/user.entity';
import { UpdatePartialUserDataDto } from './dto/update-partial-user-data.dto';
import {
  ID,
  ROLE,
  PASSWORD,
  USER_PROFILE_FIELDS,
  USER_SECRET_FIELDS,
  SPECIAL_UPDATE_FIELDS,
} from '../common/constants/user-select-fields.constants';
import { specialUpdateFields } from '../common/types/special-update-fields.type';
import { Role } from '../common/types/role.enum';
import { ErrMsg } from '../common/errors-service/error-messages.type';
import { PublicUser } from '../common/types/user-secret-key.type';

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly authService: AuthService,
    private readonly hashService: HashService,
    private readonly errorsService: ErrorsService,
  ) {}

  async getCurrentProfile(userId: number) {
    try {
      const user = await this.usersRepository.findOneOrFail({
        where: { id: userId },
        select: [...USER_PROFILE_FIELDS],
      });
      return this.authService.removeSensitiveInfo(user, [
        ...USER_SECRET_FIELDS,
      ]);
    } catch (err: unknown) {
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    }
  }

  async deleteCurrentUser(userId: number, password: string) {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = await qr.manager.findOneOrFail(User, {
        where: { id: userId },
        select: [ID, ROLE, PASSWORD],
      });
      if (user.role === Role.ADMIN) {
        this.errorsService.badRequest(ErrMsg.ADMINISTRATOR_CANNOT_BE_DELETED);
      }
      const isPasswordValid = await this.hashService.compare(
        password,
        user.password,
      );
      if (!isPasswordValid) {
        this.errorsService.badRequest(ErrMsg.CURRENT_PASSWORD_IS_INCORRECT);
      }
      await qr.manager.delete(User, { id: userId });
      await qr.commitTransaction();
    } catch (err: unknown) {
      await qr.rollbackTransaction();
      if (err instanceof HttpException) {
        throw err;
      }
      this.errorsService.userNotFound(err);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }

  async updatePartialUserData(userId: number, dto: UpdatePartialUserDataDto) {
    const specialFields: string[] = [];
    const emptyFields: string[] = [];
    const patch = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Record<string, unknown>;
    if (Object.keys(patch).length === 0) {
      this.errorsService.badRequest(ErrMsg.NO_FIELDS_FOR_UPDATE);
    }
    for (const [key, value] of Object.entries(patch)) {
      if (
        value === null ||
        (typeof value === 'string' && value.trim().length === 0)
      ) {
        emptyFields.push(key);
      }
      if (SPECIAL_UPDATE_FIELDS.includes(key as specialUpdateFields)) {
        specialFields.push(key);
      }
    }
    if (specialFields.length > 0) {
      this.errorsService.badRequest(
        ErrMsg.FIELDS_CANNOT_BE_UPDATED,
        specialFields,
      );
    }
    if (emptyFields.length > 0) {
      this.errorsService.badRequest(ErrMsg.FIELDS_CANNOT_BE_EMPTY, emptyFields);
    }
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const result = await qr.manager
        .createQueryBuilder()
        .update(User)
        .set(patch)
        .where('id = :id', { id: userId })
        .execute();
      if (result.affected === 0) {
        await qr.rollbackTransaction();
        this.errorsService.userNotFound();
      }
      const user: User = await qr.manager
        .createQueryBuilder(User, 'user')
        .addSelect(USER_PROFILE_FIELDS.map((f) => `user.${f}`))
        .where('user.id = :id', { id: userId })
        .getOneOrFail();
      await qr.commitTransaction();
      return this.authService.removeSensitiveInfo(
        user,
        USER_SECRET_FIELDS,
      ) as PublicUser;
    } catch (err) {
      await qr.rollbackTransaction();
      if (err instanceof HttpException) throw err;
      this.errorsService.userNotFound(err);
      this.errorsService.userConflict(err);
      this.errorsService.default(err);
    } finally {
      await qr.release();
    }
  }
}
