# Hybrid: bàn giao và kiểm chứng trên cloud — 12/10/2026

Đã phục hồi đúng candidate của task `Review AgriTrace hybrid architecture`
từ bộ bàn giao local. Đây là kiểm chứng code/test trên cloud, chưa là nghiệm
thu bản A hoặc rollout dev. Giữ tiến độ tổng khoảng 35%, A 60%, B 10%, C 0%
cho đến khi các phần triển khai và gate còn thiếu được hoàn tất.

## Nguồn và provenance

- Base: `b7a52339dbeefdd8c1555e95ab00ae13e764d8f0`.
- Candidate được lưu ở commit `41bbb6a` trên `feature/hybrid-chain-business-scope`.
- ZIP SHA-256: `2b9c30abeb3ed74d51f0a67abe30017796114a713581550371f141f3fdd9622f`.
- Full patch SHA-256: `dc9c7c366bc6ec13eaa7ba1834768ed9553a91f990543034e71c40f476e1112d`.
- Incremental patch SHA-256: `8b0a5d8c4f9d5c35627b9318be9abc750373b2163837bebe9ac5ba2f861420c8`.
- Ops helper patch SHA-256: `d01c4807b27267fe53fcadbcba532d1d454aa4c7a7200188602597fd3c0cbcc2`.

ZIP CRC và paths đã kiểm; ba checksum khớp checkpoint. Full patch qua
`git apply --check` trên base sạch; cả 32 file candidate khớp LF SHA-256 trong
manifest. Không áp dụng incremental lên base sạch. Các Python helper của
Windows được giữ làm evidence, không thực thi trực tiếp trên cloud.

Sau kiểm bản sao, phục hồi cùng 32 file vào checkout cloud hiện có và kiểm
hash trước commit. Không tạo worktree/task/agent khác, không sửa checkout
Windows/main của người dùng. Nhánh cloud `work` giữ nguyên baseline main.

## Kiểm chứng đạt

Runtime: Node 24.19.0, npm 12.1.0, PostgreSQL 18.6 từ image pin của CI.
Hai DB mới dùng riêng cho candidate draft và legacy regression, tách khỏi DB
ứng dụng cloud và mọi DB dev/production. Mỗi DB có 15 migration hiện có;
draft chỉ áp dụng trong hai DB test này, fixtures chỉ trong DB draft.

| Kiểm tra | Kết quả |
| --- | --- |
| Prisma generate, API lint/typecheck/build | Passed |
| API unit | 130/130 |
| SQL draft behavior | 30/30 assertions |
| Hybrid policy/HTTP/DB | 58/58 |
| Legacy E2E | 112/112 |
| Web typecheck/unit | 169/169 |
| Web lint contract | 84/84 |
| Native image optimizer | 4/4 |
| Web lint và production build | Passed |
| OpenAPI/public projection | 89 operations, committed artifacts khớp |

Hai lỗi legacy expected 403/actual 400 đã không còn trong lượt 112 E2E này.
Hai scenario preflight/assignment proposal mới chạy trong 58 DB scenarios;
kết quả chỉ chứng minh planning chỉ đọc, chưa chứng minh apply/backfill.
Prisma generate/typecheck và contract cũng đã kiểm lại tại checkout làm việc.

## Failures và giới hạn được giữ

Dependency links từ bản sao sang checkout khác làm npm graph inspection báo
extraneous/missing; cài riêng bằng frozen lockfile giải quyết graph, không đổi
manifest/lockfile. Runner Node `--test` vẫn bị giới hạn sandbox; chạy lại bằng
quyền thực thi phù hợp đạt đủ 84 tests. Không sửa product config, assertions,
test timeout hoặc lint severity để vượt các lỗi môi trường này.

Full Prisma schema diff trả exit 2, **chưa đạt zero-drift**. Báo cáo có FK
actions/defaults/indexes từ schema nền và sự khác nhau về biểu diễn predicate
partial index của StageAssignment. Không chạy SQL diff sinh ra: nó đề xuất
drop các unique sensor guards. ORM relations được exercise trong 58 DB tests;
kết quả đó không thay thế việc review schema drift trước migration promotion.
Các log trước/sau lỗi được giữ riêng, không ghi lỗi hoặc unrun là Passed.

Artifacts trên cloud nằm tại `/workspace/shared/hybrid-continuation`:
ZIP gốc, archive base, incoming checkpoint/patches/logs, `verification.json`,
bản sao candidate và thư mục `evidence`. Không đưa env/signing values vào báo cáo.
Log/state của job VPS cũ và observation window root-only chưa được đọc lại;
kiểm cloud không được dùng để tuyên bố job VPS đã terminal/cleanup hoặc healthy.

## Tiếp tục theo plan

Nguồn, plan, patch và log để code/test đã nằm trên cloud và GitHub; máy local
không cần tiếp tục chạy cho các bước này. Quyền VPS, helper vận hành đầy đủ và
deployment bindings chưa được chuyển/xác minh. Không tự coi đã có quyền rollout.

Tiếp tục A theo dependency: apply/provenance/runtime manifest pin, participant
consent, versioned journal bridge, official migration/checksum review, DB mới/
copy rehearsal, browser/mobile và CI/CD đúng SHA. Chỉ mở profile/rollout sau
các gate tương ứng; không tạo PR/app deployment nửa chừng chỉ để CI xanh.

Giữ mọi failure/window/gap trước đó và không suy ra healthy khi mất lượt kiểm.
Không deploy/restart/configure production, reset ledger/identity hoặc sửa hash,
QR/proof lịch sử. B/C tiếp tục sau A; authority peer/CA/signer doanh nghiệp thật
vẫn cần doanh nghiệp tham gia, không được ghi Passed từ technical simulation.
