import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { hash, compare } from 'bcrypt';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Real HTTP, validation, bcrypt and JWT; only persistence is replaced.
describe('Auth security (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let user: {
    id: string;
    email: string;
    passwordHash: string;
    fullName: string | null;
    organizationId: string | null;
    role: string;
    accountStatus: string;
  } | null;
  const password = 'test-password-123';
  const prisma = { user: { findUnique: vi.fn(), create: vi.fn() } };

  beforeEach(async () => {
    vi.resetAllMocks();
    user = {
      id: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
      email: 'staff@example.com',
      passwordHash: await hash(password, 4),
      fullName: 'Staff',
      organizationId: null,
      role: 'USER',
      accountStatus: 'ACTIVE',
    };
    prisma.user.findUnique.mockImplementation(({ where, select }) => {
      if (
        !user ||
        (where.id && where.id !== user.id) ||
        (where.email && where.email !== user.email)
      )
        return null;
      return select
        ? Object.fromEntries(
            Object.keys(select).map((key) => [
              key,
              user![key as keyof typeof user],
            ]),
          )
        : { ...user };
    });
    prisma.user.create.mockImplementation(({ data }) => {
      user = { id: 'af542810-92f9-4506-982b-30a1d77af793', ...data };
      const { passwordHash: _secret, ...safe } = user!;
      return safe;
    });

    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'auth-security-tests-only-secret',
        get: (_key: string, fallback: string) => fallback,
      })
      .compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = app.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('registers an unassigned USER and hashes the password', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'new@example.com', password, fullName: 'New User' })
      .expect(201);
    expect(response.body.user).toMatchObject({
      organizationId: null,
      role: 'USER',
      accountStatus: 'ACTIVE',
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(await compare(password, user!.passwordHash)).toBe(true);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
  });

  it.each([
    { organizationId: '631e9648-174d-48a0-9494-353bda8775da' },
    { organizationId: null },
    { role: 'SYSTEM_ADMIN' },
    { accountStatus: 'ACTIVE' },
  ])('rejects self-assignment: %j', async (extra) => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'new@example.com', password, ...extra })
      .expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(['LOCKED', 'INACTIVE', 'PENDING'])(
    'rejects an existing token after account becomes %s',
    async (status) => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user!.email, password })
        .expect(201);
      const authorization = `Bearer ${login.body.accessToken}`;
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', authorization)
        .expect(200);
      user!.accountStatus = status;
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', authorization)
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user!.email, password })
        .expect(401);
    },
  );

  it('rejects an existing token after the user is deleted', async () => {
    const token = jwt.sign({
      sub: user!.id,
      email: user!.email,
      role: user!.role,
    });
    user = null;
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects missing and invalid tokens before querying persistence', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects expired tokens', async () => {
    const token = jwt.sign({ sub: user!.id }, { expiresIn: -1 });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([{}, { sub: '' }, { sub: 'not-a-uuid' }])(
    'rejects signed tokens with invalid identity: %j',
    async (payload) => {
      const token = jwt.sign(payload);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );
});
