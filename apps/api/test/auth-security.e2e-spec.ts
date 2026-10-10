import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createOpenApiDocument } from '../src/common/api/openapi.js';
import { hash } from 'bcrypt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { sessionFamilyWhere } from '../src/modules/auth/session-family.js';

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
    organization: { status: string } | null;
    role: {
      id: string;
      code: string;
      name: string;
    };
    accountStatus: string;
  } | null;
  const password = 'test-password-123';
  const prisma = {
    $transaction: vi.fn(),
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    refreshSession: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    user = {
      id: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
      email: 'staff@example.com',
      passwordHash: await hash(password, 4),
      fullName: 'Staff',
      organizationId: null,
      role: {
        id: '8fb589c9-e423-4b3e-a492-a521b9094166',
        code: 'USER',
        name: 'User',
      },
      organization: null,
      accountStatus: 'ACTIVE',
    };
    const findUser = ({
      where,
      select,
    }: {
      where: { id?: string; email?: string };
      select?: Record<string, boolean>;
    }) => {
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
    };
    prisma.user.findFirst.mockImplementation(findUser);
    prisma.user.findUnique.mockImplementation(findUser);
    prisma.user.create.mockImplementation(({ data }) => {
      user = { id: 'af542810-92f9-4506-982b-30a1d77af793', ...data };
      const { passwordHash: _secret, ...safe } = user!;
      return safe;
    });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        refreshSession: prisma.refreshSession,
        user: prisma.user,
        $queryRaw: vi.fn().mockResolvedValue([]),
      }),
    );
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshSession.findFirst.mockResolvedValue({ id: 'active-session' });

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
    app.setGlobalPrefix('api');
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

  it.each([
    '/api/catalog/products',
    '/api/catalog/farms',
    '/api/catalog/plots',
    '/api/users',
    '/api/organizations',
  ])('blocks farm staff from administration at %s', async (path) => {
    user!.role.code = 'FARM_STAFF';
    const token = await jwt.signAsync({ sub: user!.id, sid: user!.id });
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', 'Bearer ' + token)
      .send({})
      .expect(403);
  });

  it('keeps public registration disabled', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password, fullName: 'New User' })
      .expect(501)
      .expect(({ body }) => {
        expect(body.message).toContain('Đăng ký đang tạm khóa');
      });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('publishes the cookie session contract and recoverable 409 in Swagger', () => {
    const document = createOpenApiDocument(app);
    expect(document.paths['/api/auth/refresh'].post?.security).toEqual([
      { agritrace_session: [] },
    ]);
    expect(document.paths['/api/auth/logout'].post?.security).toEqual([
      {},
      { agritrace_session: [] },
    ]);
    expect(document.paths['/api/auth/refresh'].post?.responses).toHaveProperty(
      '409',
    );
    expect(document.components?.schemas?.AuthSessionDto).toMatchObject({
      properties: {
        accessToken: { type: 'string' },
        sessionId: { format: 'uuid' },
      },
    });
    expect(document.components?.schemas?.AuthSessionDto).not.toHaveProperty(
      'properties.refreshToken',
    );
    expect(document.components?.schemas?.LoginDto).toMatchObject({
      required: ['email', 'password'],
    });
  });

  it('allows logout without session cookies as documented', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .expect(201)
      .expect({ revoked: true });
    expect(prisma.refreshSession.findUnique).not.toHaveBeenCalled();
  });

  it('sets a HttpOnly refresh cookie without exposing it in JSON', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user!.email, password })
      .expect(201);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeUndefined();
    const cookie = login.headers['set-cookie'][1] as string;
    const selector = login.headers['set-cookie'][0].split(';')[0];
    expect(cookie).toContain(`agritrace_refresh_${login.body.sessionId}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const token = cookie.split(';')[0].split('=')[1];
    prisma.refreshSession.findUnique.mockResolvedValue({
      id: 'session-1',
      familyId: login.body.sessionId,
      userId: user!.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user,
    });
    const refresh = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', `${selector}; ${cookie.split(';')[0]}`)
      .expect(201);
    expect(refresh.body.accessToken).toBeTruthy();
    expect(refresh.body.refreshToken).toBeUndefined();
    expect(refresh.headers['set-cookie'][0]).toContain('HttpOnly');

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(
        'Cookie',
        `${selector}; ${refresh.headers['set-cookie'][0].split(';')[0]}`,
      )
      .expect(201)
      .expect(({ headers }) => {
        expect(headers['set-cookie'][0]).toContain('Max-Age=0');
      });
  });

  it('rejects cross-origin cookie operations', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', 'agritrace_refresh=token')
      .expect(403);
  });

  it('rejects the existing access JWT immediately after logout revokes its family', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user!.email, password })
      .expect(201);
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((value) => value.split(';')[0])
      .join('; ');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    const familyId =
      prisma.refreshSession.create.mock.calls[0][0].data.familyId;
    prisma.refreshSession.findUnique.mockResolvedValue({
      id: familyId,
      familyId,
      userId: user!.id,
      user: { organizationId: null },
    });
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(201);
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { ...sessionFamilyWhere(familyId), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    prisma.refreshSession.findFirst.mockResolvedValue(null);
    const rejected = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
    expect(rejected.body.message).toContain('Phiên đăng nhập đã bị thu hồi');
  });

  it.each([
    { organizationId: '631e9648-174d-48a0-9494-353bda8775da' },
    { organizationId: null },
    { role: 'SYSTEM_ADMIN' },
    { accountStatus: 'ACTIVE' },
  ])('rejects self-assignment: %j', async (extra) => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password, ...extra })
      .expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(['LOCKED', 'INACTIVE', 'PENDING'])(
    'rejects an existing token after account becomes %s',
    async (status) => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user!.email, password })
        .expect(201);
      const authorization = `Bearer ${login.body.accessToken}`;
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', authorization)
        .expect(200);
      user!.accountStatus = status;
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', authorization)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user!.email, password })
        .expect(401);
    },
  );

  it('rejects an existing token after the user is deleted', async () => {
    const token = jwt.sign({
      sub: user!.id,
      sid: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
      email: user!.email,
      role: user!.role.code,
    });
    user = null;
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects missing and invalid tokens before querying persistence', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
    expect(missing.body.message).toContain('Thiếu Bearer token');
    const invalid = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    expect(invalid.body.message).toContain('Access token không hợp lệ');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects expired tokens', async () => {
    const token = jwt.sign({ sub: user!.id, sid: user!.id }, { expiresIn: -1 });
    const expired = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(expired.body.message).toContain('Access token đã hết hạn');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([{}, { sub: '' }, { sub: 'not-a-uuid' }])(
    'rejects signed tokens with invalid identity: %j',
    async (payload) => {
      const token = jwt.sign(payload);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );
});
