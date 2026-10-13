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

### Lượt tích hợp sau checkpoint `ae557d59`

CI agent sở hữu riêng fixture `deploy/hybrid-route-fixture*`, preflight UAT,
Compose general/UAT, hai env examples và phần container/Fabric workflows.
DB agent review chỉ đọc restore và CD; documentation agent chỉ ghi plan B mới.
Root sở hữu CD policy/controller/tests, backup metadata, helpers local và plan
này. Không bên nào đổi HEAD hoặc API/Web/SQL/scripts CI khi job DB đang chạy.

Official catalog đã áp đủ 17 migrations trên `ae557d59`, đạt 147 unit, 31 SQL,
zero diff + sáu guards, ORM, 132 policy/DB và 112 E2E. Gate tổng vẫn failed:
restore fingerprint không khớp; không OOM/restart, cleanup verified. Lưu failure,
bổ sung before/after và per-guard diagnostics trước assert, xác định sai lệch
trước khi kết luận restore đạt. Không bỏ constraints/triggers khỏi phép so sánh.

Review CD phát hiện hai dependency cutover cần sửa trước checksum admission:

1. Snapshot phải mang exact bytes/checksum của legacy pins ngoài DB, kể cả lần
   đầu image cũ chưa hiểu Hybrid. Archive env chỉ mang đường dẫn là chưa đủ.
   Rehearsal CMS decrypt/checksums phải khôi phục file sang host cách ly trống;
   không dựng lại authority từ DB đã restore.
2. Vượt floor lần đầu cần acknowledgement SHA riêng trong shared config trước
   writer stop. Recovery cũ giữ journal/writers stopped khi image8ae thiếu floor.
   Bổ sung forward recovery có kiểm soát: exact-main CI và immutable images,
   catalog identical candidate thất bại, đủ cả floor, chaincode không đổi,
   preflight/pins hợp lệ, giữ previous/baseline/backup. Cho phép hoàn tất phần
   catalog chưa áp khi lần trước dừng giữa hai migrations; không thêm catalog
   khác. Chỉ switch/clear journal sau readiness/canary/history preservation.
   Forward lỗi phải giữ journal và dừng writers; không restore DB/ledger hoặc
   start image cũ. Test partial/full floor, replay, wrong catalog/SHA, failure
   trước/sau migration và absence of compatible rollback baseline.

Lượt restore thứ hai trên cùng `ae557d59` đã xác nhận mọi table fingerprints
bằng nhau và 864 guards đủ cả trước/sau. Chỉ năm finite CHECK khác vị trí cast
`varchar[] → text[]` thành cast từng phần tử. Canonicalizer giữ whitelist đúng
năm tên/column/ordered values và hai full expressions; 21 regressions chặn đổi
domain, NULL, flags, type modifier, operator, extra conditions và guard loss.
Các raw definitions vẫn giữ riêng. Đây là kết luận từ diagnostics và
[issue PostgreSQL chính thức](https://www.postgresql.org/message-id/15611-7efe329c2185c9b9%40postgresql.org),
phù hợp [ANY](https://www.postgresql.org/docs/18/functions-comparisons.html) và
[unbounded varchar/text](https://www.postgresql.org/docs/18/datatype-character.html).
Không sửa migration hoặc bỏ CHECK để test pass. Lượt tiếp theo bổ sung indexes,
validation/enforcement/deferral flags và canonical comparisons, chưa pass DB.

Working-tree CD/transport đạt 116 Python Linux tests và 38 Node Linux tests;
CMS encrypted/decrypted snapshot + checksum/pin restore là real IO, forward
Docker/SQL/network orchestration dùng stubs. Fresh runtime readonly readiness
được wire vào preparer browser và CI container fixture nhưng chưa có DB receipt.
Giữ separate gates và không ghi evidence này như production rollout hoặc B/C.

Phân công tiếp: DB agent chỉ ghi `deploy/hybrid-restore-run{,.test}.mjs` để đưa
backup/restore vào CI; documentation agent chỉ ghi plan C mới. Root chốt code
đã bàn giao, chạy nặng tuần tự trên SHA cố định; các file đang làm dở không stage.

Review tiếp đã thêm re-read shared env (Compose đọc file live), kiểm actual
Fabric definition sát bước start sau migration/readiness/CI, xác nhận current
symlink thuộc known attempts và fsync base/journal. Regression fixture được
chỉnh để reset cả symlink khi reset state giữa subcases; giữ đầy đủ stopped/
journal/preservation assertions. Lượt mới đạt 119 CD Linux tests, không skips.
Tracked CI restore runner đạt 46 pure refusal/ownership/receipt/path tests;
chưa là real DB restore pass. CI serial order là policy → restore → API build
→ fresh browser preparation/read-only readiness → Web build → browser.

Remote main/dev vẫn `a450ca2`/`6be14c2`; production vẫn release8ae, chưa áp
Hybrid. Feature remote ở `f021e9d` khi kiểm. Sau checkpoint local và gates
cách ly sẽ push feature để dispatch Application/Blockchain CI, không trigger
production CD hoặc ghi evidence feature dispatch như main push acceptance.
Main push và rollout còn chờ scoped verifier, old-writer/copy, checksum review,
compatible app rollback và những gate nêu trên.
