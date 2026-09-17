import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Request } from 'express';
import { Server } from 'node:http';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ErrorsService } from '../src/common/errors-service/errors.service';
import {
  JournalAdminController,
  JournalController,
} from '../src/journal/journal.controller';
import { JournalService } from '../src/journal/journal.service';

describe('Journal HTTP permissions', () => {
  let app: INestApplication;
  const postId = '11111111-1111-4111-8111-111111111111';
  const service = {
    list: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, nextOffset: null }),
    importPosts: jest.fn().mockResolvedValue({ added: 1 }),
    moderate: jest.fn().mockResolvedValue({ status: 'published' }),
    photo: jest.fn(),
    config: jest.fn(),
    setSource: jest.fn(),
    refresh: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [JournalController, JournalAdminController],
      providers: [
        { provide: JournalService, useValue: service },
        RolesGuard,
        ErrorsService,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context
            .switchToHttp()
            .getRequest<Request & { user: { id: number; role: string } }>();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = {
            id: 42,
            role:
              req.headers.authorization === 'Bearer admin' ? 'admin' : 'user',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });
  it('allows the public feed but refuses a request for the pending queue', async () => {
    await request(app.getHttpServer() as Server)
      .get('/journal/posts')
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/journal/posts?status=pending')
      .expect(400);
    await request(app.getHttpServer() as Server)
      .get('/journal/posts?limit=1000')
      .expect(400);
    expect(service.list).toHaveBeenCalledTimes(1);
  });
  it('protects import, settings, review and pending photographs from guests and regular users', async () => {
    for (const authorization of [undefined, 'Bearer user']) {
      const expected = authorization ? 403 : 401;
      for (const [method, path] of [
        ['get', '/journal/admin/config'],
        ['get', '/journal/admin/posts'],
        ['post', '/journal/admin/import'],
        ['patch', '/journal/admin/config'],
        ['patch', '/journal/admin/posts/' + postId],
        ['post', '/journal/admin/posts/' + postId + '/refresh'],
        ['get', `/journal/admin/posts/${postId}/photos/${postId}`],
      ] as const) {
        const call = request(app.getHttpServer() as Server)[method](path);
        if (authorization) call.set('Authorization', authorization);
        await call.expect(expected);
      }
    }
    expect(service.importPosts).not.toHaveBeenCalled();
    expect(service.moderate).not.toHaveBeenCalled();
    expect(service.photo).not.toHaveBeenCalled();
  });
  it('requires a revision and uses the authenticated reviewer, not a body-supplied ID', async () => {
    await request(app.getHttpServer() as Server)
      .patch('/journal/admin/posts/' + postId)
      .set('Authorization', 'Bearer admin')
      .send({ status: 'published' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .patch('/journal/admin/posts/' + postId)
      .set('Authorization', 'Bearer admin')
      .send({ status: 'published', revision: 1, administratorId: 99 })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .patch('/journal/admin/posts/' + postId)
      .set('Authorization', 'Bearer admin')
      .send({ status: 'published', revision: 1 })
      .expect(200);
    expect(service.moderate).toHaveBeenCalledWith(postId, 1, 'published', 42);
    await request(app.getHttpServer() as Server)
      .post('/journal/admin/import')
      .set('Authorization', 'Bearer admin')
      .send({ offset: 0, status: 'published' })
      .expect(400);
  });
});
