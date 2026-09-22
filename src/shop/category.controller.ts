import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/types/role.enum';
import { CategoryDto } from './category.dto';
import { CategoryService } from './category.service';

@Controller('shop/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get() list() {
    return this.categories.list();
  }
}

@Controller('shop/admin/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get() list() {
    return this.categories.adminList();
  }

  @Post() create(@Body() dto: CategoryDto) {
    return this.categories.save(dto);
  }

  @Patch(':id') rename(@Param('id') id: string, @Body() dto: CategoryDto) {
    return this.categories.save(dto, id);
  }

  @Delete(':id') remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
