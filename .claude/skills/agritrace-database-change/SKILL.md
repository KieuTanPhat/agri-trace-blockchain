---
name: agritrace-database-change
description: Tạo hoặc review thay đổi Prisma schema, migration, SQL guard và ràng buộc database của AgriTrace; không kích hoạt chỉ vì đọc query thông thường.
---

# Database change của AgriTrace

Đọc [hướng dẫn chung](../../../AGENTS.md), [business rules](../../../docs/core-business-rules.md)
và [database runbook](../../../docs/database-migration-runbook.md). Trong plan/review,
chỉ phân tích; không chạy migration hoặc ghi database.

1. Đối chiếu [Prisma schema](../../../apps/api/prisma/schema.prisma), migration
   catalog, SQL guard và caller/test thực tế. Lấy acceptance từ Issue/plan liên quan,
   không suy ra một enum hoặc model mới đã được nghiệm thu.
2. Khi triển khai, append migration mới; không sửa/xóa/đổi tên migration đã có.
   Không dùng reset, seed fixture hoặc analysis SQL trên DB chung/production.
   Khi ảnh hưởng command, hash, quantity, custody hoặc quyền, kết hợp workflow
   Hybrid và đọc đúng các invariant liên quan.
3. Trước mọi thao tác DB, xác minh tài nguyên test được sở hữu và cách ly, endpoint,
   cấu hình kết nối và migration state; tên database hay localhost riêng lẻ không
   chứng minh cách ly. Không log connection string/credentials. Nếu chưa có môi
   trường phù hợp, tiếp tục phần source/static review và ghi rõ DB chưa kiểm chứng.
4. Trong môi trường test đã xác minh, dùng lệnh hiện có, với DATABASE_URL và
   TEST_DATABASE_URL cùng trỏ đúng DB cách ly:

   ```bash
   npm run prisma:generate --workspace apps/api
   npm run db:migrate --workspace apps/api
   npm run check --workspace apps/api
   ```

   Chọn thêm fresh-migrate, existing-data refusal, concurrency/replay và checksum
   regression theo thay đổi; xem [CI guide](../../../docs/ci.md). Không bỏ required tests.
5. Nếu tác động release/restore, đối chiếu [production runbook](../../../docs/production-runbook.md)
   về migration review, installed controller và compatibility floor. Database
   restore không phải app rollback; không tự chạy operator action từ skill này.

Trả migration mới, schema/source bị ảnh hưởng, môi trường và test thực đã chạy,
compatibility/recovery cần review và các phần chưa nghiệm thu. Giữ lịch sử nguyên vẹn.
