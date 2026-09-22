import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { ErrorsService } from '../src/common/errors-service/errors.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import {
  AdminCategoriesController,
  CategoriesController,
} from '../src/shop/category.controller';
import { CategoryService } from '../src/shop/category.service';

describe('Category HTTP permissions and validation', () => {
  let app: INestApplication;
  const categories = {
    list: jest.fn(),
    adminList: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CategoriesController, AdminCategoriesController],
      providers: [
        { provide: CategoryService, useValue: categories },
        RolesGuard,
        ErrorsService,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest<Request>();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user = {
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
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('allows visitors to read names without exposing admin counts', async () => {
    categories.list.mockResolvedValue([{ id: 'covers', name: 'Обложки' }]);
    await request(app.getHttpServer() as Server)
      .get('/shop/categories')
      .expect(200)
      .expect([{ id: 'covers', name: 'Обложки' }]);
    expect(categories.adminList).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Bearer customer'])(
    'rejects every admin endpoint for %s',
    async (token) => {
      for (const method of ['get', 'post', 'patch', 'delete'] as const) {
        const path =
          '/shop/admin/categories' +
          (['patch', 'delete'].includes(method) ? '/covers' : '');
        const req = request(app.getHttpServer() as Server)[method](path);
        if (token) req.set('Authorization', token);
        await req.send({ name: 'Вышивка' }).expect(token ? 403 : 401);
      }
      expect(categories.adminList).not.toHaveBeenCalled();
      expect(categories.save).not.toHaveBeenCalled();
      expect(categories.remove).not.toHaveBeenCalled();
    },
  );

  it('normalizes names and allows the owner to rename legacy category IDs', async () => {
    categories.save.mockResolvedValue({
      id: 'covers',
      name: 'Текстиль для дома',
    });
    await request(app.getHttpServer() as Server)
      .patch('/shop/admin/categories/covers')
      .set('Authorization', 'Bearer admin')
      .send({ name: '  Текстиль   для дома  ' })
      .expect(200);
    expect(categories.save).toHaveBeenCalledWith(
      { name: 'Текстиль для дома' },
      'covers',
    );
    await request(app.getHttpServer() as Server)
      .post('/shop/admin/categories')
      .set('Authorization', 'Bearer admin')
      .send({ name: 'Панно' })
      .expect(201);
    expect(categories.save).toHaveBeenCalledWith({ name: 'Панно' });
    categories.remove.mockResolvedValue({ deleted: true });
    await request(app.getHttpServer() as Server)
      .delete('/shop/admin/categories/covers')
      .set('Authorization', 'Bearer admin')
      .expect(200)
      .expect({ deleted: true });
  });

  it.each([
    { name: '   ' },
    { name: 'я'.repeat(101) },
    { name: 123 },
    { name: 'Панно', role: 'admin' },
  ])('rejects invalid category input: %j', async (body) => {
    await request(app.getHttpServer() as Server)
      .post('/shop/admin/categories')
      .set('Authorization', 'Bearer admin')
      .send(body)
      .expect(400);
    expect(categories.save).not.toHaveBeenCalled();
  });
});
