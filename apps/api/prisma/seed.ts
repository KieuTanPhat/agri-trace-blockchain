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

  await prisma.user.upsert({
    where: { email: 'admin@agritrace.local' },
    update: {
      fullName: 'Quản trị viên hệ thống',
      roleId: systemAdminRole.id,
      organizationId: null,
      accountStatus: 'ACTIVE',
    },
    create: {
      email: 'admin@agritrace.local',
      fullName: 'Quản trị viên hệ thống',
      passwordHash,
      roleId: systemAdminRole.id,
      organizationId: null,
      accountStatus: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { email: 'farm.staff@agritrace.local' },
    update: {
      fullName: 'Nguyễn Văn Nông',
      roleId: farmStaffRole.id,
      organizationId: farmOrganization.id,
      accountStatus: 'ACTIVE',
    },
    create: {
      email: 'farm.staff@agritrace.local',
      fullName: 'Nguyễn Văn Nông',
      passwordHash,
      roleId: farmStaffRole.id,
      organizationId: farmOrganization.id,
      accountStatus: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { email: 'transporter@agritrace.local' },
    update: {
      fullName: 'Trần Minh Vận',
      roleId: transporterRole.id,
      organizationId: transporterOrganization.id,
      accountStatus: 'ACTIVE',
    },
    create: {
      email: 'transporter@agritrace.local',
      fullName: 'Trần Minh Vận',
      passwordHash,
      roleId: transporterRole.id,
      organizationId: transporterOrganization.id,
      accountStatus: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { email: 'retailer@agritrace.local' },
    update: {
      fullName: 'Lê An Tâm',
      roleId: retailerRole.id,
      organizationId: retailerOrganization.id,
      accountStatus: 'ACTIVE',
    },
    create: {
      email: 'retailer@agritrace.local',
      fullName: 'Lê An Tâm',
      passwordHash,
      roleId: retailerRole.id,
      organizationId: retailerOrganization.id,
      accountStatus: 'ACTIVE',
    },
  });

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

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });