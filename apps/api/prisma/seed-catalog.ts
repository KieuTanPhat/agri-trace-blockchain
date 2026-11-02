import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  assertDemoCatalogTarget,
  createDemoCatalog,
  DEMO_CATALOG_NAMESPACE,
  DemoCatalogRefusal,
} from './demo-catalog.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run'))
    throw new DemoCatalogRefusal('Tham số seed không hợp lệ.');
  const catalog = createDemoCatalog();
  if (args.includes('--dry-run')) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        organizations: catalog.organizations.length,
        products: catalog.products.length,
        namespace: DEMO_CATALOG_NAMESPACE,
      }),
    );
    return;
  }
  const database = assertDemoCatalogTarget(process.env);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${DEMO_CATALOG_NAMESPACE}, 0))`;
        const [identity] = await tx.$queryRaw<
          Array<{ database: string; owned: boolean }>
        >`
        SELECT current_database() AS database, pg_get_userbyid(datdba) = current_user AS owned
        FROM pg_database WHERE datname = current_database()`;
        if (identity?.database !== database || !identity.owned)
          throw new DemoCatalogRefusal(
            'Kết nối không sở hữu DB demo đã xác nhận.',
          );
        if (
          (await tx.user.count()) ||
          (await tx.productionCycle.count()) ||
          (await tx.lot.count()) ||
          (await tx.traceEvent.count())
        )
          throw new DemoCatalogRefusal(
            'DB có account/nghiệp vụ. Từ chối seed; hãy tạo DB cách ly mới.',
          );
        const organizations = await tx.organization.findMany({
          select: { id: true, name: true, type: true, status: true },
        });
        const products = await tx.product.findMany({
          select: {
            id: true,
            organizationId: true,
            evidenceComplete: true,
            category: true,
            productName: true,
            variety: true,
            defaultUnit: true,
            description: true,
            status: true,
          },
        });
        for (const [rows, expected] of [
          [organizations, catalog.organizations],
          [products, catalog.products],
        ] as const) {
          for (const row of rows) {
            const match = expected.find((item) => item.id === row.id);
            if (
              !match ||
              Object.entries(row).some(
                ([key, value]) =>
                  (match as unknown as Record<string, unknown>)[key] !== value,
              )
            )
              throw new DemoCatalogRefusal(
                'Danh mục không thuộc fixture hoặc đã chỉnh sửa. Không ghi đè/xóa dữ liệu.',
              );
          }
        }
        await tx.organization.createMany({
          data: catalog.organizations,
          skipDuplicates: true,
        });
        await tx.product.createMany({
          data: catalog.products,
          skipDuplicates: true,
        });
      },
      { timeout: 30_000 },
    );
    console.log(
      'Seed catalog hoàn tất: 30 doanh nghiệp, 100 sản phẩm. Không tạo account, lô/QR hoặc blockchain proof.',
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof DemoCatalogRefusal
      ? error.message
      : 'Seed không thành công; không in cấu hình kết nối. Kiểm tra migration/DB test trước khi thử lại.',
  );
  process.exitCode = 1;
});
