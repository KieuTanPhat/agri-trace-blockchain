# Hướng dẫn cho coding assistant trong repository

<!-- CODEGRAPH_START -->
## CodeGraph

Nếu repository có thư mục `.codegraph/` ở gốc, dùng CodeGraph TRƯỚC grep/find hoặc đọc file khi cần hiểu hay tìm mã:

- **MCP tool** (nếu có): `codegraph_explore` trả source nguyên văn của symbol và call path, kể cả dynamic dispatch. Nêu file hoặc symbol trong query để đọc source hiện tại có số dòng. Nếu tool đang deferred, tìm và tải tool theo tên.
- **Shell**: `codegraph explore "<symbol names or question>"` trả thông tin tương tự.

Nếu không có `.codegraph/`, bỏ qua CodeGraph. Quyết định tạo index thuộc chủ dự án.
<!-- CODEGRAPH_END -->

## Đọc trước khi đổi hành vi

1. Đọc [README.md](README.md) để biết lệnh và bản đồ tài liệu.
2. Đọc [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) để hiểu mô hình hiện tại
   `ProductionCycle → HarvestEvent → Lot → Shipment`, phạm vi 4 tuần và khoảng cách
   giữa quy tắc đã duyệt với hành vi đã triển khai. Đọc
   [docs/core-business-rules.md](docs/core-business-rules.md) trước khi đổi phân quyền,
   quantity, sensor window, trace hash hoặc command recovery.
3. Đối chiếu source, Prisma schema/migration và NestJS Swagger hiện tại. Dùng GitHub
   Issue AGT làm nguồn acceptance và phân công hiện hành.
4. [Đặc tả nghiệp vụ cũ](docs/archive/business-specification-v1.2.md) mô tả mô hình
   `Batch`. Giữ nội dung nghiệp vụ nhưng dùng source hiện tại và plan core/Hybrid
   để triển khai. Nêu rõ khoảng cách khi mục tiêu đã duyệt khác source; không mô tả
   mục tiêu chưa có trong mã là đã hoàn tất.

API contract nằm trong Swagger sinh từ NestJS. Cập nhật tài liệu liên quan khi đổi
hành vi hoặc lệnh. Không đưa private key, token hay payload nhạy cảm vào ví dụ.

## Giữ bất biến và tài liệu

- Giữ authorization, organization scope, optimistic version và idempotency trong
  cùng transaction với domain write, trace/outbox và command journal. Không cấp
  quyền ghi nghiệp vụ cho Admin/Auditor để vượt test.
- Không sửa migration đã áp, event hash, sensor window, proof, quantity hay lịch sử
  để che bất nhất. Dừng ghi ở phần bị ảnh hưởng và đối soát; kết quả command chưa rõ
  không cho phép dùng idempotency key mới.
- Chạy test database trên DB cách ly đã migrate. Mock/fixture và CI xanh không
  chứng minh nghiệm thu Fabric thật hoặc nghiệp vụ trên production.
- Khi làm deployment, đọc [vận hành production](docs/production-runbook.md), đối
  chiếu lệnh với revision controller đã cài. Chỉ cập nhật helper bằng quy trình
  digest đã review, giữ điều kiện khóa/journal và khả năng phục hồi bản trước.
  Config schema 2 và controller UAT đã retire; không trộn các thế hệ controller.
- Sửa guide hiện có khi lệnh/hành vi đổi. Giữ plan chứa quyết định và acceptance.
  Ghi bằng chứng từng lần chạy vào PR/Issue hoặc artifact local; không tạo thêm
  báo cáo Markdown cho từng run.

## Đặt tên nhánh

Dùng tên theo mục đích: `feature/agt-010-generated-openapi`,
`fix/agt-006-auth-refresh-sessions`, `refactor/project-structure`, `ci/...`,
`docs/...`, `chore/...`. Dùng lowercase kebab-case và task ID nếu có.
Không tạo nhánh mới `codex/...` hoặc tên cá nhân nếu chủ dự án chưa yêu cầu đúng
tên đó. Giữ `main`, `dev` là nhánh chung; `integration/...` chỉ nhánh thành viên
legacy được giữ lại. Đọc [quy tắc và bản đồ đổi tên nhánh](docs/branch-naming.md)
trước khi dùng lại hoặc push nhánh cũ.
