---
name: agritrace-api-contract
description: Cập nhật hoặc review contract NestJS của AgriTrace khi đổi DTO, Swagger decorators, request/response/errors/security metadata hoặc generated API types.
---

# API contract của AgriTrace

Đọc [hướng dẫn chung](../../../AGENTS.md) và phần API contract trong
[README](../../../README.md). Khi chỉ lập kế hoạch/review, chỉ đọc và mô tả kiểm
tra cần chạy; không generate hoặc sửa file.

1. Xác định endpoint và consumer bị ảnh hưởng từ source, Issue AGT liên quan và
   [context hiện hành](../../../docs/PROJECT_CONTEXT.md). Swagger sinh từ NestJS
   là contract; không lấy interface Web hoặc mô tả Issue làm schema gốc.
2. Đối chiếu DTO/decorator, response interceptor, exception filter và metadata
   trong [nguồn OpenAPI](../../../apps/api/src/common/api/openapi.ts). Giữ envelope,
   lỗi/security metadata, null/date/Decimal và Idempotency-Key đúng runtime.
   Khi chạm scope/public fields, đọc [business rules](../../../docs/core-business-rules.md).
3. Sửa metadata/source trước. Không chỉnh tay JSON, checksum hoặc Web types đã sinh.
   Dùng script repo, sau khi dependency đã cài trên Node/npm hỗ trợ:

   ```bash
   npm run prisma:generate --workspace apps/api
   npm run build --workspace blockchain/gateway
   npm run api-contract:generate
   npm run api-contract:check
   ```

   Exporter không cần DB/Fabric thật; không cấp production credentials cho nó.
4. Review diff contract và consumers, operation IDs, public privacy và breaking
   changes. Chạy test API/Web liên quan theo [CI guide](../../../docs/ci.md);
   test DB cần môi trường cách ly đã migrate. Không coi codegen pass là runtime acceptance.

Trả endpoint/source đã đổi, artifact sinh lại, ảnh hưởng consumer, kiểm tra thực
đã chạy và phần chưa xác minh. Giữ quyết định/acceptance ở Issue/plan hiện có.
