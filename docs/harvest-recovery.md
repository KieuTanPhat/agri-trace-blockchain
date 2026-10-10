# Phục hồi yêu cầu thu hoạch

Form thu hoạch lưu metadata trước khi gửi: scope user/role/org, cycle ID,
Idempotency-Key, thời gian thu hoạch cố định, fingerprint SHA-256 và revision.
Không lưu token đăng nhập, nội dung form hoặc QR vào browser storage. Một actor
chỉ có một intent thu hoạch cần xử lý tại một thời điểm trên cùng origin.

Sau reload/navigation hoặc đăng nhập lại cùng account, form đọc intent rồi gọi
`GET /production-cycles/:cycleId/harvest-request-status` với header
`Idempotency-Key`. API yêu cầu phiên active, FARM_STAFF, cycle thuộc org hiện
tại và scope journal khớp. Requester khác không đọc được kết quả. Response
`Cache-Control: no-store`; Swagger trong NestJS là nguồn contract.

- `COMMITTED`: journal bất biến xác nhận commit; mở lại Lot/QR đã tạo.
- `NOT_FOUND`: giữ key/time/fingerprint. Nhập lại đúng fields để thử lại cùng
  yêu cầu; trạng thái này không cho phép thay key vì request cũ có thể đến chậm.
- `NEEDS_RECONCILIATION`: không gửi lại command hoặc thay key. Kiểm tra lại,
  rồi nhờ operator đối soát nếu vẫn chưa rõ; không tự xóa record/journal.
- `REJECTED`: lỗi nghiệp vụ terminal đã được lưu, không có journal commit.
  Người dùng có thể chủ động bắt đầu lần ghi nhận mới để sửa nội dung.

Kết quả thành công vẫn giữ intent. Nút **Ghi nhận lần thu hoạch mới** xác nhận
lại kết quả trên server và thay revision trước khi mở form mới. Web Locks
serialize các tab; revision chặn form cũ gửi thêm Lot sau khi tab khác đã bắt
đầu lần mới. Nếu storage hỏng/không ghi được hoặc trình duyệt thiếu Web Locks
trên secure context, dừng trước POST và hiển thị cách xử lý.

Metadata phụ thuộc profile trình duyệt và origin. Không tự phục hồi trên thiết
bị/domain khác hoặc sau khi người dùng xóa storage; đối soát lô trên server
trước khi nhập lại ở các trường hợp này. Không có TTL tự cấp key mới. Với lỗi
validation trước khi server tạo idempotency record, vẫn giữ intent và yêu cầu
đối soát nếu không thể gửi lại đúng fields. Không thay hash, quantity hoặc
sensor window của command đã commit.

Regression: mất phản hồi sau commit, mất mạng trước commit, remount, hai tab,
form cũ, scope thay đổi, storage lỗi và journal thiếu. API E2E dùng PostgreSQL
18 disposable và kiểm một Harvest/Lot/QR/window/HARVEST_IN, hai trace/outbox
sau replay; không tạo fixture lỗi trên UAT. Không có migration mới.
