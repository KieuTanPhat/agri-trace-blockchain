# Kiểm chứng core cho PR #75 — 10/10/2026

PR: [#75](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/75).
Baseline main: `9e228b7c236d9527727b496849d07ca2d160d04f`.
Hai commit triển khai ban đầu: `f5210e7`, `4203d93`.
Người dùng yêu cầu tạo PR, kiểm tra và chỉ merge khi đạt.

## Vòng kiểm tra đầu và sửa regression

CI trên head `4203d934c693c2be77b30a2c715353b98ad22723` đạt dependency
audit và production containers, nhưng chưa đạt Application/Blockchain gate.
Fixtures chaincode/Gateway vẫn gửi contract cũ, kiểm tra kiến trúc còn tìm
transaction trực tiếp, policy/offline expectations chưa theo hành vi mới.
Fabric integration còn kỳ vọng 4 events; harvest hiện tạo thêm một event
`SENSOR_DIGEST_FINALIZED`, nên phải kiểm đúng 5 events/outbox.

Sửa fixtures và assertions theo contract đã duyệt; không nới quyền, giảm
coverage thresholds, bỏ test hoặc thay production validator để qua gate.
Bổ sung ca deny private fields, duplicate collision theo public tuple,
legacy ledger read, rollback và các luồng nghiệp vụ mới.

## Bằng chứng local sau sửa

Windows x64 / Node 24.19.0 / npm 12.1.0 / PostgreSQL 18. Cluster test mới
chỉ nghe loopback, dùng database riêng `agri_trace_pr75_test`; không kết nối
database UAT/production. Các kết quả này được thu trên working tree sửa test
trước commit; CI của head PR sau commit là evidence cho quyết định merge.

| Kiểm tra | Kết quả |
| --- | --- |
| Prisma migrate deploy trên DB trống riêng | 14 migrations đạt, gồm 5 migrations mới. |
| API lint/typecheck/build | Đạt. |
| API unit | 91 đạt. |
| API E2E trên PostgreSQL có trigger thật | 90 đạt, không skip. |
| Web check | 104 unit/component, 84 lint contract, 4 image optimizer; typecheck/lint/production build đạt. |
| Chaincode check | 67 test đạt; build/typecheck/runtime load đạt. |
| Chaincode coverage | Lines 99.41%, statements 99.43%, branches 97.32%, functions 100%. |
| Gateway check | 26 test, build/typecheck/runtime load đạt. |
| Worker và compiled chaincode validator | 1 contract test đạt. |
| OpenAPI drift/public projection | 67 operations khớp JSON/checksum/generated Web types. |
| Installed root dependency graph | Full/production: 0 advisory; không invalid peer. |
| CI/CD Node logic | 25 đạt; 3 SSH transport cases dành cho Linux skip trên Windows. |
| CD Python policy/controller | 20 đạt; 10 fsync/flock cases dành cho Linux skip trên Windows. |

Các ca PostgreSQL bổ sung kiểm journal replay sau domain commit nhưng cache
completion lỗi; rollback không orphan khi trace insertion lỗi; expired
PROCESSING thiếu journal không tự chạy lại; sensor window riêng, cutoff,
late readings, NO_DATA và immutable evidence; exact Farm damage; full sale,
competing sale requests, recall sau SOLD không tạo movement 0; custody/version,
expire, immutable certificate correction, public replacement và forbidden
Lot writes không tạo idempotency/business data.

## Điều kiện merge và phát hành

- Thu Application gate, Blockchain gate và Dependency gate thành công cùng
  head SHA hiện tại của PR; kiểm các job bắt buộc thực sự chạy và không skip.
- Kiểm PostgreSQL 16, matrix Node 22/24/26, standalone chaincode install/audit,
  production container/backup-restore và API → Worker → Fabric integration
  trên GitHub CI. Các kết quả/link/SHA cuối ghi trong PR.
- Không bypass ruleset hoặc merge khi head/base đổi chưa được kiểm lại.
- Merge source không thay acceptance/signoff từng AGT, UAT mobile hoặc release
  approval. Không đóng AGT bằng PR này.
- SQL và Fabric cutover trên môi trường đang chạy vẫn cần review/rehearsal
  riêng. `deploy/cd/controller.py` kiểm migration policy và chaincode fingerprint
  trước `stop(old)`; giữ nguyên cơ chế từ chối automatic rollout khi candidate
  yêu cầu migration có trigger hoặc chaincode upgrade chưa được duyệt.
- Coverage của test không phải bằng chứng ổn định vận hành >99%.

Lệnh tái lập và cutover nằm trong
[implementation record](core-implementation-2026-10-10.md).
