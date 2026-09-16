import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import {
  CreateRequestDto,
  NewsletterDto,
  ProductDto,
  RequestStatusDto,
  TokenDto,
  WithdrawDto,
} from './shop.dto';
import { ShopService } from './shop.service';
import { SubscriptionService } from './subscription.service';
import { OptionalJwtGuard, ShopWriteGuard } from './shop.guards';
@Controller('shop')
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly subscriptions: SubscriptionService,
  ) {}
  @Get('config') config() {
    return {
      demo: process.env.NODE_ENV !== 'production',
      currency: 'RUB',
      checkoutMode: 'request',
      analytics: false,
      sellerStatus: 'NPD',
    };
  }
  @Get('products') products() {
    return this.shop.products();
  }
  @Get('products/:slug') product(@Param('slug') slug: string) {
    return this.shop.product(slug);
  }
  @Post('requests') @UseGuards(OptionalJwtGuard, ShopWriteGuard) request(
    @Body() dto: CreateRequestDto,
    @Req() req: Request,
  ) {
    return this.shop.createRequest(
      dto,
      (req.user as User | undefined)?.id ?? null,
    );
  }
  @Get('me/requests') @UseGuards(JwtAuthGuard) requests(@Req() req: Request) {
    return this.shop.requests((req.user as User).id);
  }
  @Get('me/favorites') @UseGuards(JwtAuthGuard) favorites(@Req() req: Request) {
    return this.shop.favorites((req.user as User).id);
  }
  @Post('me/favorites/:id') @UseGuards(JwtAuthGuard) favorite(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.shop.favorite((req.user as User).id, id, true);
  }
  @Delete('me/favorites/:id') @UseGuards(JwtAuthGuard) unfavorite(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.shop.favorite((req.user as User).id, id, false);
  }
  @Post('newsletter/request') @UseGuards(ShopWriteGuard) subscribe(
    @Body() dto: NewsletterDto,
  ) {
    return this.subscriptions.request(dto);
  }
  @Post('newsletter/confirm') @UseGuards(ShopWriteGuard) confirm(
    @Body() dto: TokenDto,
  ) {
    return this.subscriptions.confirm(dto.token);
  }
  @Post('newsletter/unsubscribe') @UseGuards(ShopWriteGuard) unsubscribe(
    @Body() dto: TokenDto,
  ) {
    return this.subscriptions.unsubscribe(dto.token);
  }
  @Get('me/consents') @UseGuards(JwtAuthGuard) consents(@Req() req: Request) {
    return this.subscriptions.status((req.user as User).id);
  }
  @Post('me/consents/withdraw') @UseGuards(JwtAuthGuard) withdraw(
    @Req() req: Request,
    @Body() dto: WithdrawDto,
  ) {
    return this.subscriptions.withdraw((req.user as User).id, dto.purpose);
  }
}
@Controller('shop/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ShopAdminController {
  constructor(private readonly shop: ShopService) {}
  @Get('products') products() {
    return this.shop.products(true);
  }
  @Post('products') create(@Body() dto: ProductDto) {
    return this.shop.saveProduct(dto);
  }
  @Patch('products/:id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductDto,
  ) {
    return this.shop.saveProduct(dto, id);
  }
  @Get('requests') requests() {
    return this.shop.allRequests();
  }
  @Patch('requests/:id') status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestStatusDto,
  ) {
    return this.shop.updateStatus(id, dto.status);
  }
}
