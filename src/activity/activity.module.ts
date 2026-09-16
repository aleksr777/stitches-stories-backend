import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityService } from './activity.service';
import { ActivityFlushService } from './activity-flush.service';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [ActivityService, ActivityFlushService],
  exports: [ActivityService],
})
export class ActivityModule {}
