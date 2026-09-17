import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/types/role.enum';
import { User } from '../users/entities/user.entity';
import {
  JournalImportDto,
  JournalModerateDto,
  JournalPageDto,
  JournalQueueDto,
  JournalRevisionDto,
  JournalSourceDto,
} from './journal.dto';
import { JournalService } from './journal.service';

function sendPhoto(image: { data: Buffer; mime: string }, response: Response) {
  // Withdrawal takes effect for subsequent requests; no CDN/browser public cache of photos.
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(image.data, {
    type: image.mime,
    disposition: 'inline',
  });
}

@Controller('journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}
  @Get('posts') posts(
    @Query() page: JournalPageDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.journal.list(page);
  }
  @Get('posts/:id/photos/:photoId') async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendPhoto(await this.journal.photo(id, photoId), response);
  }
}

@Controller('journal/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class JournalAdminController {
  constructor(private readonly journal: JournalService) {}
  @Get('config') config() {
    return this.journal.config();
  }
  @Patch('config') setSource(@Body() dto: JournalSourceDto) {
    return this.journal.setSource(dto.pageUrl);
  }
  @Post('import') importPosts(@Body() dto: JournalImportDto) {
    return this.journal.importPosts(dto.offset);
  }
  @Get('posts') posts(@Query() query: JournalQueueDto) {
    return this.journal.list(query, query.status, true);
  }
  @Patch('posts/:id') moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JournalModerateDto,
    @Req() request: Request,
  ) {
    return this.journal.moderate(
      id,
      dto.revision,
      dto.status,
      (request.user as User).id,
    );
  }
  @Post('posts/:id/refresh') refresh(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JournalRevisionDto,
    @Req() request: Request,
  ) {
    return this.journal.refresh(id, dto.revision, (request.user as User).id);
  }
  @Get('posts/:id/photos/:photoId') async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendPhoto(await this.journal.photo(id, photoId, true), response);
  }
}
