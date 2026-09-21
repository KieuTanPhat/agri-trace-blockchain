import 'dotenv/config';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL chưa được cấu hình');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DEFAULT_PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await hash(DEFAULT_PASSWORD, 12);

  const systemAdminRole = await prisma.role.upsert({
    where: { code: 'SYSTEM_ADMIN' },
    update: { name: 'Quản trị hệ thống' },
    create: {
      code: 'SYSTEM_ADMIN',
      name: 'Quản trị hệ thống',
    },
  });

  const farmStaffRole = await prisma.role.upsert({
    where: { code: 'FARM_STAFF' },
    update: { name: 'Nhân viên nông trại' },
    create: {
      code: 'FARM_STAFF',
      name: 'Nhân viên nông trại',
    },
  });

  const transporterRole = await prisma.role.upsert({
    where: { code: 'TRANSPORTER' },
    update: { name: 'Đơn vị vận chuyển' },
    create: {
      code: 'TRANSPORTER',
      name: 'Đơn vị vận chuyển',
    },
  });

  const retailerRole = await prisma.role.upsert({
    where: { code: 'RETAILER' },
    update: { name: 'Nhà bán lẻ' },
    create: {
      code: 'RETAILER',
      name: 'Nhà bán lẻ',
    },
  });

  const auditorRole = await prisma.role.upsert({
    where: { code: 'AUDITOR' },
    update: { name: 'Thanh tra viên' },
    create: { code: 'AUDITOR', name: 'Thanh tra viên' },
  });

  const farmOrganization =
    (await prisma.organization.findFirst({
      where: {
        name: 'Hợp tác xã Rau sạch Tân Phú',
        type: 'FARM',
      },
    })) ??
    (await prisma.organization.create({
      data: {
        name: 'Hợp tác xã Rau sạch Tân Phú',
        type: 'FARM',
        status: 'ACTIVE',
      },
    }));

  const transporterOrganization =
    (await prisma.organization.findFirst({
      where: {
        name: 'Công ty Vận tải Minh Phát',
        type: 'TRANSPORTER',
      },
    })) ??
    (await prisma.organization.create({
      data: {
        name: 'Công ty Vận tải Minh Phát',
        type: 'TRANSPORTER',
        status: 'ACTIVE',
      },
    }));

  const retailerOrganization =
    (await prisma.organization.findFirst({
      where: {
        name: 'Cửa hàng Nông sản An Tâm',
        type: 'RETAILER',
      },
    })) ??
    (await prisma.organization.create({
      data: {
        name: 'Cửa hàng Nông sản An Tâm',
        type: 'RETAILER',
        status: 'ACTIVE',
      },
    }));

  const auditorOrganization =
    (await prisma.organization.findFirst({
      where: { name: 'Trung tâm Kiểm định Nông sản', type: 'AUDITOR' },
    })) ??
    (await prisma.organization.create({
      data: {
        name: 'Trung tâm Kiểm định Nông sản',
        type: 'AUDITOR',
        status: 'ACTIVE',
      },
    }));

  await upsertUser(
    'admin@agritrace.local',
    {
      fullName: 'Quản trị viên hệ thống',
      roleId: systemAdminRole.id,
      organizationId: null,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  await upsertUser(
    'farm.staff@agritrace.local',
    {
      fullName: 'Nguyễn Văn Nông',
      roleId: farmStaffRole.id,
      organizationId: farmOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  await upsertUser(
    'transporter@agritrace.local',
    {
      fullName: 'Trần Minh Vận',
      roleId: transporterRole.id,
      organizationId: transporterOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  await upsertUser(
    'retailer@agritrace.local',
    {
      fullName: 'Lê An Tâm',
      roleId: retailerRole.id,
      organizationId: retailerOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  await upsertUser(
    'auditor@agritrace.local',
    {
      fullName: 'Phạm Minh Kiểm',
      roleId: auditorRole.id,
      organizationId: auditorOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  const product =
    (await prisma.product.findFirst({
      where: {
        productName: 'Rau cải xanh',
        variety: 'Cải ngọt',
      },
    })) ??
    (await prisma.product.create({
      data: {
        productName: 'Rau cải xanh',
        variety: 'Cải ngọt',
        defaultUnit: 'kg',
        status: 'ACTIVE',
      },
    }));

  const farm =
    (await prisma.farm.findFirst({
      where: {
        name: 'Nông trại Tân Phú',
        organizationId: farmOrganization.id,
      },
    })) ??
    (await prisma.farm.create({
      data: {
        name: 'Nông trại Tân Phú',
        location: 'TP. Hồ Chí Minh',
        status: 'ACTIVE',
        organizationId: farmOrganization.id,
      },
    }));

  await prisma.plot.upsert({
    where: {
      farmId_name: {
        farmId: farm.id,
        name: 'Khu trồng A',
      },
    },
    update: {
      area: 500,
      unit: 'm2',
      status: 'ACTIVE',
    },
    create: {
      farmId: farm.id,
      name: 'Khu trồng A',
      area: 500,
      unit: 'm2',
      status: 'ACTIVE',
    },
  });

  await prisma.plot.upsert({
    where: {
      farmId_name: {
        farmId: farm.id,
        name: 'Khu trồng B',
      },
    },
    update: {
      area: 300,
      unit: 'm2',
      status: 'ACTIVE',
    },
    create: {
      farmId: farm.id,
      name: 'Khu trồng B',
      area: 300,
      unit: 'm2',
      status: 'ACTIVE',
    },
  });

  console.log(`Seed hoàn tất. Product mẫu: ${product.productName}`);
  console.log(`Tài khoản test dùng mật khẩu: ${DEFAULT_PASSWORD}`);
}

async function upsertUser(
  email: string,
  data: {
    fullName: string;
    roleId: string;
    organizationId: string | null;
    accountStatus: 'ACTIVE';
  },
  passwordHash: string,
) {
  const existing = await prisma.user.findFirst({ where: { email } });
  return existing
    ? prisma.user.update({ where: { id: existing.id }, data })
    : prisma.user.create({ data: { email, passwordHash, ...data } });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
