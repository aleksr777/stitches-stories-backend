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
  PaymentController,
  AdminPaymentController,
} from './payments/payment.controller';
import { PaymentConfigService } from './payments/payment-config.service';
import { PaymentService } from './payments/payment.service';
import { PaymentMaintenanceService } from './payments/payment-maintenance.service';
import {
  CustomerOnlyGuard,
  OptionalJwtGuard,
  ShopWriteGuard,
} from './shop.guards';
@Module({
  imports: [AuthModule, LegalModule, TypeOrmModule.forFeature(shopEntities)],
  controllers: [
    PaymentController,
    AdminPaymentController,
    ShopController,
    ShopAdminController,
    CategoriesController,
    AdminCategoriesController,
  ],
  providers: [
    PaymentConfigService,
    PaymentService,
    PaymentMaintenanceService,
    ShopService,
    CategoryService,
    SubscriptionService,
    ShopWriteGuard,
    OptionalJwtGuard,
    CustomerOnlyGuard,
  ],
})
export class ShopModule {}
