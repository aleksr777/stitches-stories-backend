import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { CustomerOnlyGuard } from './shop.guards';
import { DeliveryAddressDto } from './delivery-address.dto';
import { DeliveryAddressService } from './delivery-address.service';

@Controller('shop/me/addresses')
@UseGuards(JwtAuthGuard, CustomerOnlyGuard)
export class DeliveryAddressController {
  constructor(private readonly addresses: DeliveryAddressService) {}

  @Get()
  list(@Req() request: Request) {
    return this.addresses.list((request.user as User).id);
  }

  @Post()
  create(@Req() request: Request, @Body() dto: DeliveryAddressDto) {
    return this.addresses.create((request.user as User).id, dto);
  }

  @Put(':id')
  update(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliveryAddressDto,
  ) {
    return this.addresses.update((request.user as User).id, id, dto);
  }

  @Delete(':id')
  remove(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.addresses.remove((request.user as User).id, id);
  }
}
