// Uses the compiled client shipped in the production API image; no tsx needed.
import 'dotenv/config';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../dist/generated/prisma/client.js';

let database;
try {
  if (!process.env.DATABASE_URL) throw new Error('Missing database configuration');
  database = new PrismaClient({adapter: new PrismaPg({connectionString: process.env.DATABASE_URL})});
  const result = await database.role.createMany({
    data: [{code: 'COMPLIANCE_REVIEWER', name: 'Người duyệt tuân thủ',
      description: 'Chỉ duyệt trên nông trại được phân công'}],
    skipDuplicates: true,
  });
  console.log(`COMPLIANCE_REVIEWER provisioned; created=${result.count}`);
} catch {
  console.error('Không thể provision COMPLIANCE_REVIEWER; kiểm tra migration và kết nối DB');
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
