import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { LegalModule } from '../legal/legal.module';
import { shopEntities } from './shop.entities';
import { ShopController, ShopAdminController } from './shop.controller';
import { ShopService } from './shop.service';
import { SubscriptionService } from './subscription.service';
import {
  AdminCategoriesController,
  CategoriesController,
} from './category.controller';
import { CategoryService } from './category.service';
import {
  CustomerOnlyGuard,
  OptionalJwtGuard,
  ShopWriteGuard,
} from './shop.guards';
@Module({
  imports: [AuthModule, LegalModule, TypeOrmModule.forFeature(shopEntities)],
  controllers: [
    ShopController,
    ShopAdminController,
    CategoriesController,
    AdminCategoriesController,
  ],
  providers: [
    ShopService,
    CategoryService,
    SubscriptionService,
    ShopWriteGuard,
    OptionalJwtGuard,
    CustomerOnlyGuard,
  ],
})
export class ShopModule {}
