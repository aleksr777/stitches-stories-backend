import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/types/role.enum';
import { User } from '../../users/entities/user.entity';
import { CustomerOnlyGuard, ShopWriteGuard } from '../shop.guards';
import { PaymentConfigService } from './payment-config.service';
import { IssuePaymentDto, StartPaymentDto } from './payment.dto';
import { PaymentService } from './payment.service';

@Controller('shop/payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}
  @Post('robokassa/result')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  receive(@Body() body: unknown) {
    return this.payments.receive(body);
  }

  @Post(':id/view')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, CustomerOnlyGuard)
  view(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.payments.view(id, req.user as User);
  }
  @Post(':id/start')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard, CustomerOnlyGuard, ShopWriteGuard)
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartPaymentDto,
    @Req() req: Request,
  ) {
    return this.payments.start(id, dto, req.user as User);
  }
}

@Controller('shop/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminPaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly config: PaymentConfigService,
  ) {}
  @Get('payments/config')
  @Header('Cache-Control', 'no-store')
  settings() {
    return this.config.publicConfig();
  }
  @Get('requests/:id/payment')
  @Header('Cache-Control', 'no-store')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.adminView(id);
  }
  @Post('requests/:id/payment')
  @Header('Cache-Control', 'no-store')
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssuePaymentDto) {
    return this.payments.issue(id, dto);
  }
}
