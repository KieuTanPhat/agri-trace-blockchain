# Review source migration Hybrid A — 13/10/2026

Hai migration đã được promote vào source catalog của nhánh Hybrid. Đây chưa là
approval áp DB production, CD checksum approval hoặc nghiệm thu toàn bộ A/B/C.
Production hiện vẫn dùng cleanup release `8ae13542aee92b47d7ed64a0d83d560dbb517dc3`,
channel `agritrace`, sequence 3; xem
[receipt production](production-only-deployment-2026-10-13.md).
Dev/nongtrace.site đã retire; không dựng lại môi trường này để chạy rehearsal.

## Source và checksum được review

| Migration | SHA-256 LF |
| --- | --- |
| [20261013010000_hybrid_business_scope](../apps/api/prisma/migrations/20261013010000_hybrid_business_scope/migration.sql) | `a7ddb508e19a9179887a3bcc4fb233e0999af689ab6c962488579f8db9e6bbee` |
| [20261013011000_immutable_ledger_routes](../apps/api/prisma/migrations/20261013011000_immutable_ledger_routes/migration.sql) | `1066a02962d2f67724e49646c94edfe3d3f564655e89f94886e55560beaf36ed` |

Promotion được đối chiếu với source trước promotion
`5bc74773cbadc845ea53485e6f8977a123844baf`: 15 migration trước giữ nguyên bytes LF;
SQL body của migration scope khớp hai draft business/legacy ghép theo đúng thứ tự,
và body route khớp route draft, sau khi bỏ comments/transaction wrappers và chuẩn
hóa whitespace. Scope/legacy giờ dùng một transaction `BEGIN`/`COMMIT`; route
cũng có transaction riêng. Đây là đối chiếu source, chưa là execution receipt
của catalog mới. Receipt local:
`.codex/evidence/hybrid-migration-promotion-20261013.json`.

Ba draft SQL trùng source đã gỡ. Fixture được chuyển sang
[hybrid-business-scope.test.sql](sql/hybrid-business-scope.test.sql), giữ assertions
và guards. Các digest/log draft trong tài liệu ngày 12/10 là evidence lịch sử,
không phải lệnh triển khai hiện hành. Applied migrations, journal, domain history,
ledger hashes, QR và keys không nằm trong phạm vi xóa.

## Evidence có trước promotion

| Exact SHA | Kết quả và phạm vi |
| --- | --- |
| `cab1cf5b5da8e0373646e64a5a0640f06ab9f1ac` | PostgreSQL 18 local cách ly: 147 API unit, 31 SQL scenarios, full Prisma diff zero + 6 unique guards, ORM, 132 policy/DB cases (26 HTTP groups), 112 legacy E2E; container/network/port/keeper cleanup verified. |
| `5bc74773cbadc845ea53485e6f8977a123844baf` | Bảy browser groups trên Next production build, Nest API và PostgreSQL thật; app/container/network/ports/keeper cleanup verified. |
| `0c846e1437ace40e65efa00c9ea699ae96598a5f` | 76 CD Python regressions chạy Linux không skip; strict migration floor giữ độc lập với `compatible_migrations`. |

DB receipt:
`.codex/evidence/hybrid-local/agritrace-hybrid-local-cab1cf5b-1791835463921622800`.
Browser receipt:
`.codex/evidence/hybrid-local/agritrace-hybrid-local-browser-5bc74773-1791855493931239000`.

Browser kiểm lost-response/commit/reload/remount/two-tab recovery, activation,
UI invitations/acceptance, ba party consent/regrant/new revision/finalize,
revoked-manager mobile view, unknown expired PROCESSING hold và account isolation.
Chromium 151/Playwright 1.62.1 dùng iPhone 13 viewport/touch emulation; chưa phải
Safari/iOS thật. DB suite dùng synthetic proof/mock Fabric adapter. Không gọi
hai suite này là Fabric VALID commit hoặc authority của doanh nghiệp thật.
Không gán kết quả các SHA trên cho source promotion/SHA mới chưa chạy lại.

Giữ failures trước đó: completed seed thiếu `completedAt`, global SQL fixture
update đụng ACTIVE seed, duplicate canonical HIST definition và chọn nhầm event;
browser stale-finalize cần reconcile request cũ, UI refresh/selection fixture.
Sửa tiền điều kiện/fixture mà giữ assertions và runtime guards. Các lượt có
container OOM false/restart 0 không chứng minh khó pass do thiếu RAM. Timeout
được giữ là failure/partial evidence, không đổi thành Passed.

## Kết quả review và mức độ

| Mức độ | Phát hiện / gate | Xử lý hiện hành |
| --- | --- | --- |
| P2 — tài liệu | Links/lệnh draft vẫn trỏ file đã gỡ; một mô tả manifest còn nhận environment `dev`. | Chuyển links hiện hành sang migration/fixture source, environment đúng `isolated`/`production`; giữ các receipts cũ có nhãn lịch sử. |
| P1 — gate release | Sau route migration, proof insert/update phải có route; writer cũ không tạo được event mới. Resume trước import/pins hoặc rollback về image thiếu schema có thể gây outage. | Writer pause, controlled import, independent pins và scope/route-aware image là điều kiện trước resume. Chưa có receipt rollout. |
| P1 — gate recovery | First schema-floor cutover không có image cũ tương thích. | Required migration floor chặn old `8ae` ngay cả khi generic compatibility list chứa tên migration. Failure giữ writers stopped/journal để recovery/fix forward; không start image cũ hoặc tự restore DB để rollback app. |
| Chưa phát hiện defect mới trong promotion | SQL body/source history và thứ tự tạo function/trigger/FK đã review đọc; guards giữ provenance, current consent, immutable mapping/route và fail closed. | Vẫn phải chạy catalog mới và fault/restore/compatible-image rehearsal. Static review không thay DB/Fabric acceptance hoặc chứng nhận code sạch 100%. |

Migration route seal đúng tập trace event preexisting dưới table lock. Legacy
rows chưa có route được giữ unresolved; event mới cần route WRITE trước commit.
Proof destination/hash và predecessor route được kiểm. Runtime vẫn phải tính
lại canonical definition/artifact và đối chiếu pins ngoài DB trước read/claim;
SQL registries không tự chứng minh governance hoặc chữ ký của doanh nghiệp.

## Gate còn thiếu trước production

Theo [migration/release plan](plans/hybrid-migration-and-release-2026-10-13.md):

1. Chạy catalog chính thức trên fresh DB và legacy writer fixture trước route seal;
   alignment, SQL/ORM/policy/legacy E2E/browser cùng actual counts/exact SHA.
2. Backup/restore PostgreSQL 18 vào DB cách ly, đối chiếu migration catalog,
   snapshot/hash/proof/journal/QR; bổ sung old production writer/restricted copy
   coverage khi cần. Synthetic fixture không được ghi là production copy.
3. Wiring CI exact SHA và artifact/cleanup; API hoặc Web đều chọn Hybrid job;
   missing/skip/cancel/failure phải chặn gate. Chưa có receipt CI của promotion.
4. Chỉ nhận exact migration checksum vào CD allowlist sau rehearsal/review;
   không nới arbitrary SQL parser. Floor vẫn độc lập generic compatibility list.
5. Preflight route/import/legacy pins độc lập, logical Worker authority và API
   không có signer; test rollback giữa hai images hiểu scope/route. Chưa có
   preflight/compatible-image acceptance cho promotion.
6. Push main sau gates theo ủy quyền, exact-SHA CI, production backup/canary/
   proof/history/QR checks và observation có samples thật; giữ gaps/failures.

B tiếp tục binding/router/ledger permission barriers/hosted-self-managed/rotation/
restore; C tiếp tục commitment vectors/key authority/assertion/intent/handover/
versioned readers/UI. Toàn task vẫn chưa hoàn tất. Whole-project review → plan →
sửa → kiểm chứng còn phải thực hiện; chỉ shutdown local sau khi mọi đầu ra và
cleanup/handoff đã hoàn thành, không force mất dữ liệu chưa lưu.
