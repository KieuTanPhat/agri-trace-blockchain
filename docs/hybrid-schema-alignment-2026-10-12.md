# Schema alignment cho candidate bản A — 12/10/2026

Đây là kiểm chứng PostgreSQL cách ly, chưa là migration promotion hoặc
acceptance toàn bộ A. Không thực thi SQL sinh từ Prisma diff.

Baseline `f021e9d503553bf8f65f7328cd8b5af1ffc84c28` đã được tái hiện trên DB
PostgreSQL 18 mới, chạy 15 migration hiện có và SQL draft. Diff exit 2:

- Hai unique index `uq_sensor_digest_window` và
  `ux_sensor_digest_final_cycle` có trong migration nhưng thiếu Prisma.
- 15 FK của journal/compliance/sensor dùng SQL `NO ACTION`; Prisma ghi
  `RESTRICT`. Alignment chỉ đổi metadata, không thay FK đang có.
- Default trace của migration là `trace-event-1`/`RFC8785-JCS-v1`;
  TraceService ghi rõ `2.0.0`/`RFC8785` cho event mới. Giữ default DB,
  không đổi version/hash của event lịch sử.
- Ba partial index assignment được PostgreSQL biểu diễn bằng enum `ANY`
  thay vì `IN`. Dùng đúng predicate introspection, giữ uniqueness.

Không thay applied migration, SQL draft, trigger hoặc constraint để làm diff
xanh. Quan hệ cycle–sensor digest vẫn là danh sách; partial uniqueness của
final digest không biến mọi digest thành quan hệ một–một.

Thêm lệnh chặn drift và kiểm sáu unique guard trong catalog:

```bash
HYBRID_DRAFT_TESTS=1 npm run db:check:alignment --workspace apps/api
```

`TEST_DATABASE_URL` phải là DB test riêng đã migrate/apply draft. Lệnh chỉ đọc
catalog và sinh diagnostic diff, không execute SQL diff. Không truyền URL
database qua command line/log.

Evidence baseline root-private:
`/opt/agri-trace-admin/hybrid-alignment-jobs/agritrace-hybrid-alignment-1791800101425262437`.
Job đã terminal và xác nhận container/network test được dọn. Source archive
SHA-256 `7010a9fe1b69148dda8926e00eb36925da0e06c31b9a7d443dc59cfca90ecb91`.

Candidate `a4b48e3e485d5902ddad38f93e00cddc9ff4f1d1` đã qua Prisma validate
local và full schema diff exit **0** trên PostgreSQL 18 mới với 15 migration
và draft. Không execute SQL diff. Catalog giữ hai unique sensor guards và ba
assignment guards; container/network test đã dọn. Evidence:
`/opt/agri-trace-admin/hybrid-alignment-jobs/agritrace-hybrid-alignment-1791800727140045540`.

Candidate tiếp theo kiểm replay quyền hiện hành dưới transaction lock, cùng
giao thức với write. Bài PostgreSQL quan sát revoke chờ lock thật trên
`pg_stat_activity`; replay không gọi lại command. Local typecheck đạt; suite
PostgreSQL/HTTP/legacy của SHA mới còn phải chạy. Giữ failure baseline và
mọi observation gaps trước đó. Zero-drift không thay nghiệm thu backfill,
journal bridge, migration promotion hoặc các gate A/B/C.
