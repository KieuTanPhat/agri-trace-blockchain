import 'dotenv/config';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  type ScopedRole,
} from '../src/generated/prisma/client.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Demo seeding is disabled in production');
}

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

  const farmStaffUser = await upsertUser(
    'farm.staff@agritrace.local',
    {
      fullName: 'Nguyễn Văn Nông',
      roleId: farmStaffRole.id,
      organizationId: farmOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  const transporterUser = await upsertUser(
    'transporter@agritrace.local',
    {
      fullName: 'Trần Minh Vận',
      roleId: transporterRole.id,
      organizationId: transporterOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  const retailerUser = await upsertUser(
    'retailer@agritrace.local',
    {
      fullName: 'Lê An Tâm',
      roleId: retailerRole.id,
      organizationId: retailerOrganization.id,
      accountStatus: 'ACTIVE',
    },
    passwordHash,
  );

  const auditorUser = await upsertUser(
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

  await seedDemoChain({
    farm: { organizationId: farmOrganization.id, userId: farmStaffUser.id },
    transporter: {
      organizationId: transporterOrganization.id,
      userId: transporterUser.id,
    },
    retailer: {
      organizationId: retailerOrganization.id,
      userId: retailerUser.id,
    },
    auditor: { organizationId: auditorOrganization.id, userId: auditorUser.id },
    farmId: farm.id,
  });

  console.log(`Seed hoàn tất. Product mẫu: ${product.productName}`);
  console.log(`Tài khoản test dùng mật khẩu: ${DEFAULT_PASSWORD}`);
}

type Party = { organizationId: string; userId: string };

/** Local demo scope: one ACTIVE chain owned by the farm cooperative, with the
 * partners as members and the minimum grants for every stage. Idempotent. */
async function seedDemoChain(input: {
  farm: Party;
  transporter: Party;
  retailer: Party;
  auditor: Party;
  farmId: string;
}) {
  const name = 'Chuỗi rau sạch Tân Phú';
  const existing = await prisma.supplyChain.findFirst({
    where: { name, ownerOrganizationId: input.farm.organizationId },
  });
  const chainId =
    existing?.id ??
    (await prisma.$transaction(async (tx) => {
      const chain = await tx.supplyChain.create({
        data: { name, ownerOrganizationId: input.farm.organizationId },
      });
      for (const party of [
        input.farm,
        input.transporter,
        input.retailer,
        input.auditor,
      ])
        await tx.chainMembership.create({
          data: {
            chainId: chain.id,
            organizationId: party.organizationId,
            status: 'ACTIVE',
          },
        });
      await tx.chainBusinessProfile.create({ data: { chainId: chain.id } });
      await tx.chainBusinessProfile.update({
        where: { chainId: chain.id },
        data: { state: 'ACTIVE', version: { increment: 1 } },
      });
      return chain.id;
    }));
  const grants: Array<[Party, ScopedRole, boolean]> = [
    [input.farm, 'ORG_ADMIN', false],
    [input.farm, 'CREATE_CHAIN', false],
    [input.farm, 'CHAIN_MANAGER', true],
    [input.farm, 'FARM_STAFF', true],
    [input.transporter, 'ORG_ADMIN', false],
    [input.transporter, 'TRANSPORTER', true],
    [input.retailer, 'ORG_ADMIN', false],
    [input.retailer, 'RETAILER', true],
    [input.auditor, 'ORG_ADMIN', false],
    [input.auditor, 'AUDITOR', true],
    [input.auditor, 'COMPLIANCE_REVIEWER', true],
  ];
  for (const [party, role, chained] of grants) {
    const where = {
      userId: party.userId,
      organizationId: party.organizationId,
      chainId: chained ? chainId : null,
      role,
      revokedAt: null,
    };
    if (!(await prisma.scopedRoleGrant.findFirst({ where })))
      await prisma.scopedRoleGrant.create({
        data: {
          userId: party.userId,
          organizationId: party.organizationId,
          chainId: chained ? chainId : null,
          scope: chained ? 'CHAIN' : 'ORGANIZATION',
          role,
        },
      });
  }
  if (
    !(await prisma.complianceAssignment.findFirst({
      where: {
        reviewerUserId: input.auditor.userId,
        farmId: input.farmId,
        revokedAt: null,
      },
    }))
  )
    await prisma.complianceAssignment.create({
      data: { reviewerUserId: input.auditor.userId, farmId: input.farmId },
    });
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
