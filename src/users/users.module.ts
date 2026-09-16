import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { EmailChangeService } from './email-change.service';
import { PasswordChangeService } from './password-change.service';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [UsersController],
  providers: [UsersService, EmailChangeService, PasswordChangeService],
  exports: [UsersService],
})
export class UsersModule {}
