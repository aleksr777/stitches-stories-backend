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
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { clearRefreshCookie } from '../auth/auth-response.util';
import { SecurityConfigService } from '../common/security/security-config.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import {
  CreateRequestDto,
  NewsletterDto,
  RequestStatusDto,
  TokenDto,
  WithdrawDto,
} from './shop.dto';
import { ShopService } from './shop.service';
import { SubscriptionService } from './subscription.service';
import { OptionalJwtGuard, ShopWriteGuard } from './shop.guards';
import {
  ProductFilesInterceptor,
  ProductImageUpload,
  parseProductPayload,
} from './product-upload';
import { ProductImage } from './shop.entities';

function sendProductImage(
  image: ProductImage,
  response: Response,
  administrator = false,
) {
  response.setHeader(
    'Cache-Control',
    administrator ? 'private, no-store' : 'private, no-cache',
  );
  response.setHeader('ETag', '"' + image.sha256 + '"');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Disposition', 'inline');
  response.type(image.mime).send(image.data);
}
@Controller('shop')
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly subscriptions: SubscriptionService,
    private readonly securityConfig: SecurityConfigService,
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
  @Get('images/:id') async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    sendProductImage(await this.shop.image(id), response);
  }
  @Post('requests') @UseGuards(OptionalJwtGuard, ShopWriteGuard) request(
    @Body() dto: CreateRequestDto,
    @Req() req: Request,
  ) {
    const user = req.user as User | undefined;
    return this.shop.createRequest(dto, user?.id ?? null, user?.role);
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
    const user = req.user as User;
    return this.shop.favorite(user.id, id, true, user.role);
  }
  @Delete('me/favorites/:id') @UseGuards(JwtAuthGuard) unfavorite(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = req.user as User;
    return this.shop.favorite(user.id, id, false, user.role);
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
  @Post('me/consents/withdraw') @UseGuards(JwtAuthGuard) async withdraw(
    @Req() req: Request,
    @Body() dto: WithdrawDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.subscriptions.withdraw(
      (req.user as User).id,
      dto.purpose,
      dto.password,
    );
    if (result.accountClosed) clearRefreshCookie(response, this.securityConfig);
    return result;
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
  @Post('products') @UseInterceptors(ProductFilesInterceptor) async create(
    @Body() body: unknown,
    @UploadedFiles() files?: ProductImageUpload[],
  ) {
    return this.shop.saveProduct(
      await parseProductPayload(body),
      undefined,
      files,
    );
  }
  @Patch('products/:id') @UseInterceptors(ProductFilesInterceptor) async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UploadedFiles() files?: ProductImageUpload[],
  ) {
    return this.shop.saveProduct(await parseProductPayload(body), id, files);
  }
  @Delete('products/:id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.shop.removeProduct(id);
  }
  @Get('images/:id') async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ) {
    sendProductImage(await this.shop.image(id, true), response, true);
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
