# Hướng dẫn cho coding assistant trong repository

<!-- CODEGRAPH_START -->
## CodeGraph

Nếu repository có thư mục `.codegraph/` ở gốc, dùng CodeGraph TRƯỚC grep/find hoặc đọc file khi cần hiểu hay tìm mã:

- **MCP tool** (nếu có): `codegraph_explore` trả source nguyên văn của symbol và call path, kể cả dynamic dispatch. Nêu file hoặc symbol trong query để đọc source hiện tại có số dòng. Nếu tool đang deferred, tìm và tải tool theo tên.
- **Shell**: `codegraph explore "<symbol names or question>"` trả thông tin tương tự.

Nếu không có `.codegraph/`, bỏ qua CodeGraph. Quyết định tạo index thuộc chủ dự án.
<!-- CODEGRAPH_END -->

## Dự án và nguồn đối chiếu

Monorepo gồm Next.js Web, NestJS API, PostgreSQL, dedicated Worker và Hyperledger
Fabric Gateway/chaincode. Mô hình là `ProductionCycle → HarvestEvent → Lot → Shipment`.
API nhận command; domain/journal/trace/outbox commit trong PostgreSQL; Worker gửi
Fabric và lưu proof. API không nhận signing key và không chạy relay timer.

Khi bắt đầu task đổi hành vi, đọc [README.md](README.md) và
[PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md), rồi chỉ đọc tài liệu cần cho task.
Không đọc lại toàn bộ trước mỗi file; sửa typo chỉ cần ngữ cảnh liên quan.
Kiểm tra branch, worktree và SHA thực tế, không suy ra từ tên nhánh ghi trong docs.

| Cần xác định | Nguồn |
| --- | --- |
| Hành vi đã triển khai | Source, Prisma schema/migration và Swagger sinh từ NestJS |
| Mục tiêu, acceptance và phân công | Issue AGT liên quan và quyết định/plan đã duyệt |
| Nghiệm thu runtime | Evidence đúng SHA, controller revision và môi trường |
| Bối cảnh lịch sử | ADR/plan có ngày và archive; không coi baseline là source hiện hành |

[Đặc tả cũ](docs/archive/business-specification-v1.2.md) dùng mô hình `Batch`.
Nêu rõ khoảng cách giữa mục tiêu, implementation và evidence; không tự sửa lịch sử
để làm chúng khớp. Giữ ủy quyền hiện có đúng phạm vi; skill không mở rộng quyền task.

## Đọc theo tác vụ

Skill nguồn dùng chung nằm ở `.agents/skills`; Claude dùng bản sinh tương ứng.
Đọc skill phù hợp khi task có trigger dưới đây, kể cả trong chế độ lập kế hoạch.
Task nhiều vùng kết hợp các skill liên quan, không kéo task nhỏ sang vùng khác.

| Trigger | Skill | Tài liệu chính |
| --- | --- | --- |
| DTO/decorator, request/response/error/security metadata, generated types | `agritrace-api-contract` | README, source OpenAPI và API/Web liên quan |
| Schema, migration, SQL guard, ràng buộc DB | `agritrace-database-change` | Database runbook, business rules |
| Authorization, quantity/custody, sensor window, trace/hash, binding/signature, outbox/Worker/recovery | `agritrace-hybrid-integrity` | Business rules, ADR-001/004, Hybrid runbook |
| UI, frontend auth/recovery, QR, PWA, signer | `agritrace-frontend-change` | Frontend guide; business rules khi đổi hành vi nghiệp vụ |
| Chuẩn bị/đánh giá release, controller, CI/CD, rollback/restore | `agritrace-production-release` | Production runbook, CI guide, release plan hiện hành |

Xem [guide agent](docs/agent-workflow.md) cho cách gọi skill/reviewer theo client.
Nếu client thiếu skill discovery, đọc trực tiếp `SKILL.md` tại nguồn chung.
Tài liệu được tham chiếu phải đối chiếu source; đường dẫn trong Issue cũ có thể đã đổi.

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

## Hoàn tất và phối hợp

Chạy kiểm tra phù hợp phạm vi thay đổi theo README/CI guide. Nêu rõ kết quả thực,
kiểm tra chưa chạy và giới hạn môi trường; không dùng mock/skip thay nghiệm thu thật.
Khi sửa bộ agent, chỉ sửa skill nguồn rồi chạy `npm run agents:sync`,
`npm run agents:check` và `npm run test:agents`; không sửa bản sinh riêng cho Claude.
Không đưa memory cá nhân, launch config, evidence hoặc worktree vào commit.

Khi người dùng yêu cầu review độc lập, dùng `agritrace-reviewer` nếu client hỗ trợ;
nếu không, truyền hướng dẫn reviewer cho agent thường và nói rõ fallback.
Không tự tạo nhiều agent cho mọi thay đổi. Mỗi checkout chỉ có một writer;
Claude/Codex cùng sửa code dùng worktree riêng và phạm vi rõ. Reviewer nhận diff,
base/head SHA, đọc hướng dẫn chung và chỉ trả findings có bằng chứng.
