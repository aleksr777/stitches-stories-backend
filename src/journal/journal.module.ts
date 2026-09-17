import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import {
  JournalAdminController,
  JournalController,
} from './journal.controller';
import { JournalService } from './journal.service';
import { VkClient } from './vk.client';
@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [JournalController, JournalAdminController],
  providers: [JournalService, VkClient],
})
export class JournalModule {}
