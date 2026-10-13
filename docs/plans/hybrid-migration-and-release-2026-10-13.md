# Migration và release A — 13/10/2026

Scope/legacy import và route import đã đạt candidate DB gate tại `cab1cf5`.
Bảy nhóm browser đã đạt trên `5bc74773`, với API/DB thật và cleanup đầy đủ.
Kế hoạch này chỉ triển khai A; B/C tiếp tục
theo plan chính. Không áp draft lên DB dùng chung hoặc suy DB mock thành Fabric.

1. Hoàn tất bảy nhóm browser trên Next production build, Nest API và PG18.
   Giữ mọi failures, current authority, original body/key và cleanup receipts.
2. Promote hai migration append-only: `20261013010000_hybrid_business_scope`
   gom business và controlled legacy scope trong một transaction;
   `20261013011000_immutable_ledger_routes` seal preexisting events và thêm route/
   import registries/guards. Không thay bytes của 15 migration trước. Chuyển các
   SQL draft sang source migration duy nhất, cập nhật links/harness hiện hành.
3. Fresh DB đi qua toàn bộ official catalog. Synthetic legacy rehearsal dùng
   catalog trước route, ghi 28 events bằng fixture writer cũ rồi áp route migration.
   Chạy zero Prisma diff/sáu guards, SQL/ORM/policy/legacy E2E và snapshot/import
   preservation. Backup bằng PG18, restore vào DB cách ly rỗng, đối chiếu bytes,
   migration catalog và invariants. Fixture tổng hợp không là production copy.
4. Rehearsal bằng old production app/writer và restricted encrypted copy nếu cần
   bổ sung data-shape coverage; không redact private trace rồi giữ hash cũ. Artifact
   inventory/proof/writer descriptor được pin ngoài DB trước import, không tự chọn
   route theo env hiện tại. Unknown PROCESSING giữ hold, không sửa lease/key/hash.
5. CI trong repo chạy exact SHA: official migration, legacy preparation trước seal,
   alignment/SQL/ORM/policy/legacy E2E và bảy browser groups. API/Web thay đổi đều
   chọn job Hybrid; gate không coi missing/skip/cancel là success. Evidence giữ SHA,
   counts thực, schema checksum, synthetic flag, browser/device scope và cleanup.
6. Review checksum sau rehearsal. `REVIEWED_EXPANSIONS` chỉ nhận đúng bytes mới;
   arbitrary SQL parser giữ restrictive. Hai migrations thuộc required schema floor,
   không được receipt `compatible_migrations` chung cho phép image cũ thiếu floor.
7. Release metadata/env phải chuyển độc lập route/import/legacy pins và logical
   Worker authority; API không mount signer. Image rollback phải hiểu scope/route,
   giữ pins lịch sử và đọc được journal/proof cũ. Test rollback giữa hai image đã
   hiểu schema mới; image8ae trước Hybrid không là rollback target tương thích.
8. Lần vượt schema floor đầu tiên là cutover có writer pause/backup/gates riêng.
   Nếu lỗi sau migration, giữ writers stopped và journal cho recovery/fix forward;
   không tự start image8ae hoặc restore DB cũ để rollback app. Chỉ mở lại bằng image
   hiểu schema, đã rehearsal và exact-SHA CI, rồi canary/proof/history/QR checks.
9. Merge origin/main vào worktree feature khi an toàn, giữ hai docs dirty và AGENTS
   untracked. Push main fast-forward theo ủy quyền; không switch Desktop/main.
   Theo dõi ba CI exact SHA, rollout production, backup/canary/rollback/observation.
   Gate24h cần samples thực, mọi gaps/failures giữ nguyên. Khi chờ làm tiếp B/C độc lập.

Sau A → B → C và toàn bộ gates, rà toàn project theo yêu cầu người dùng: phát hiện
→ kế hoạch sửa/xóa có căn cứ → sửa → kiểm chứng → review lại. Chỉ xóa khi xác nhận
không có caller hoặc giá trị migration/history/compatibility/generated contract.
Hoàn tất MD/evidence/push/cleanup trước shutdown local; không force mất dữ liệu.

## Phân công song song theo chỉ thị mới ngày 13/10/2026

Người dùng đã thay yêu cầu cũ không dùng agent bằng quyền chủ động dùng tối đa
2–3 subagent. Ba phần độc lập dùng cùng worktree nhưng có quyền ghi riêng:

| Phụ trách            | Quyền ghi                                                                                         | Đầu ra và điểm bàn giao                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| DB migration harness | `scripts/ci/hybrid-db-prepare.mjs`, `scripts/ci/hybrid-orm-check.mjs`                             | Chuẩn bị legacy trước seal, fresh browser, guards DB/SHA và receipt        |
| CI hybrid harness    | Application workflow; `scripts/ci/{changes,gate,ci.test,hybrid-policy-run}.mjs`                   | Chọn job API hoặc Web, gate bắt buộc, runner kiểm counts/cleanup thực      |
| Documentation/review | README root/API, ADR002/003, CI docs, legacy implementation/rehearsal, migration review ngày13/10 | Sửa links hiện hành, giữ evidence lịch sử, báo lỗi SQL để root xử lý       |
| Root                 | Hai migration mới, helpers local, deployment/rollback và plan này                                 | Review tích hợp, commit có chọn lọc, test nặng tuần tự, quyết định release |

Subagent không commit/stage/push hoặc chạy DB/browser/Docker. Root chỉ chạy suite
sau khi mọi bên đã bàn giao và ngừng sửa source thuộc fence; không chạy trùng job.
Hai docs dirty có sẵn và `AGENTS.md` untracked giữ nguyên. Tất cả evidence gắn SHA
đã commit; hoàn tất script hoặc tài liệu chưa được tính là pass runtime.
