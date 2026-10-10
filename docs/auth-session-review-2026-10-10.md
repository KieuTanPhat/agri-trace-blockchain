# AGT-006: sửa PR #71 và kiểm tra đồng thời

Ngày: 10/10/2026 (Asia/Saigon). Task: [AGT-006 #18](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/18).
PR: [#71](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/71).

## Các lỗi đã sửa

| Lỗi | Hành vi sau sửa | Regression |
| --- | --- | --- |
| Refresh tạo phiên sau khi logout/khóa user/tắt tổ chức thu hồi | Khóa hàng organization rồi user, đọc lại phiên/trạng thái trong transaction; revocation lấy cùng khóa trước khi quét phiên. Sau mở khóa, JWT và refresh token cũ vẫn bị 401. | PostgreSQL: giữ rotation trước insert, cho writer cạnh tranh, xác nhận writer chờ DB lock và không còn phiên active sau cả hai commit. Kiểm cả thứ tự disable trước refresh. |
| Response refresh A về muộn ghi đè cookie B | Login chọn family bằng cookie riêng; refresh/logout chỉ đổi cookie có tên chứa family của request. Login B thu hồi family A. | HTTP + PostgreSQL + cookie jar: áp response thành công/401/logout của A sau login B, rồi refresh lại vẫn là B; JWT A bị chặn. |
| Migration bị auto-CD chặn và phá rollback | Chỉ thêm cột nullable và index; session legacy dùng ID hàng làm family. | Policy đọc SQL thực tế; PostgreSQL insert không truyền family_id như API cũ, rồi rotate/logout bằng API mới. |
| Tab cũ còn token và dữ liệu của A | Metadata đổi phiên qua storage; kiểm marker trước khi gửi request và khi nhận response. Tab cũ xóa dữ liệu/cache rồi restore bằng cookie B. | Web: storage login/logout, marker đổi trước thao tác ghi, response cũ, cache scope. |
| Refresh 409 làm mất trạng thái đăng nhập | Retry có backoff, giữ session hiện có; startup/cross-tab restore giữ loading và retry nếu rotation còn bận. | Web: 409 rồi success, hết retry vẫn giữ session, startup retry khi chưa có session. |
| Xóa cache IoT sai key | Lưu/xóa cùng `IOT_READING_STORAGE_KEY:getAuthorizationScope(user)`; invalidate tập trung khi logout/đổi user, role hoặc tổ chức. | Web: logout và đổi role xóa đúng key. |

Rà soát bổ sung đã sửa race login với disable, chặn request trong lúc đổi identity,
giữ thời hạn family cố định để cookie chọn phiên và DB hết hạn cùng lúc, và đặt
`Cache-Control: no-store` cho profile. Swagger sinh từ controller/DTO có cookie
security, response envelope và lỗi 401/403/409. Smoke/CD giữ cả selector và refresh
cookie qua rotation.

## Kiểm chứng local

Môi trường: Windows, Node 24.19.0, npm 12.1.0, PostgreSQL 18; database test
riêng trên loopback. Không dùng database UAT/production.

- `npm run check --workspace apps/api`: lint/typecheck/build, 91 unit tests và
  77 E2E tests pass; 14 case của suite concurrency dùng PostgreSQL thật.
- `python -m unittest discover -s deploy/cd -p 'test_*.py' -v`: 20 pass,
  10 kiểm tra Linux fsync/flock được skip trên Windows; CI Linux chạy đầy đủ.
- Web: 104 unit/component tests; kết quả lint/typecheck/build và CI của commit
  cuối được ghi trong PR trước khi merge.

Conflict khi tích hợp main ở `apps/web/src/lib/api-client.spec.ts` đã xử lý,
giữ kiểm tra public projection của main và cookie session của PR. Migration
trong PR chưa có trên main nên được sửa trước merge/rollout; giữ nguyên SQL
của các migration đã có trên main.
