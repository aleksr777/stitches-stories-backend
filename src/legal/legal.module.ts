import { Module, Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { LegalDocumentEntity, ConsentEvent } from './legal.entities';
import { LegalService } from './legal.service';
@Controller('legal')
class LegalController {
  constructor(private readonly legal: LegalService) {}
  @Get('documents') list() {
    return this.legal.list();
  }
  @Get('documents/:id') document(@Param('id') id: string) {
    return this.legal.get(id);
  }
  @Get('documents/:id/versions/:version') version(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.legal.version(id, version);
  }
  @Get('me/events') @UseGuards(JwtAuthGuard) events(@Req() req: Request) {
    return this.legal.history((req.user as User).id);
  }
}
@Module({
  imports: [TypeOrmModule.forFeature([LegalDocumentEntity, ConsentEvent])],
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
