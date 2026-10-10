import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL chưa được cấu hình');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
try {
  // Additive and repeatable. Existing roles, users and assignments are untouched.
  const result = await prisma.role.createMany({
    data: [
      {
        code: 'COMPLIANCE_REVIEWER',
        name: 'Người duyệt tuân thủ',
        description: 'Chỉ duyệt trên nông trại được phân công',
      },
    ],
    skipDuplicates: true,
  });
  console.log(`COMPLIANCE_REVIEWER provisioned; created=${result.count}`);
} catch {
  console.error(
    'Không thể provision COMPLIANCE_REVIEWER; kiểm tra migration và kết nối DB',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
