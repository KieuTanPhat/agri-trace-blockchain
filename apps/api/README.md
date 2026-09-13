# Agri Trace API

## Chạy local với PostgreSQL + Prisma

```bash
npm install
cp .env.example .env
# sửa DATABASE_URL và JWT_SECRET trong .env
npx prisma db push
npx prisma generate
npm run start:dev
```

API mặc định chạy tại `http://localhost:3000`.

## Luồng JWT local

- `POST /auth/register`: tạo tài khoản, hash mật khẩu bằng bcrypt và trả access token.
- `POST /auth/login`: kiểm tra email/mật khẩu trong PostgreSQL và trả access token.
- `GET /auth/me`: yêu cầu header `Authorization: Bearer <token>`.

Import `postman/Agri-Trace-Auth.postman_collection.json` vào Postman và chạy lần lượt ba request. Request đăng nhập tự lưu token vào collection variable để request `/auth/me` sử dụng.

Đăng ký chỉ nhận `email`, `password`, `fullName` (tùy chọn). Gửi thêm
`organizationId`, `role` hoặc `accountStatus` sẽ bị từ chối với HTTP 400.
Tài khoản được tạo với `organizationId = null`, `role = USER`, `accountStatus = ACTIVE`.
`USER` chỉ là tài khoản local chưa được gán quyền nghiệp vụ; API nghiệp vụ phải kiểm tra
role, organization, ownership và state theo v1.2, không chỉ kiểm tra đăng nhập.

Public register hiện là luồng local mở rộng, chưa được mô tả trong nghiệp vụ v1.2.
v1.2 giao quyền tạo/gán user cho `SYSTEM_ADMIN`; luồng duyệt thành viên hoặc OTP
chưa được triển khai và cần nhóm thống nhất trước khi bổ sung.

`JwtAuthGuard` xác minh JWT rồi đọc user từ PostgreSQL trong mỗi request được bảo vệ.
User đã bị xóa hoặc có `accountStatus` khác `ACTIVE` bị từ chối với HTTP 401,
kể cả token còn hạn. Role và organization trong `request.user` lấy từ DB hiện tại,
không lấy quyền cũ trong token. Khi mở khóa lại, token chưa hết hạn có thể dùng lại;
bản sửa này chưa triển khai thu hồi token vĩnh viễn/đăng xuất mọi thiết bị.

Endpoint health check: `GET /health`.

## Kiểm thử auth

```bash
npm test
npm run test:e2e
npm run lint
npm run build
```

Test bảo mật HTTP dùng JWT/bcrypt/ValidationPipe thật và mock Prisma, không sửa DB thật.
Các ca kiểm tra gồm: chặn tự gán organization/role/status; đăng ký hợp lệ;
token còn hạn bị từ chối sau khi khóa/xóa user; token sai/hết hạn;
và guard lấy quyền hiện tại từ DB thay cho quyền cũ trong token.


## DANH MỤC STATUS
# Trong tài liệu
Bảng Batch CurrentState 
Giá trị bao gồm:
CREATED, PLANTED, HAVESTED, IN_TRANSPORT, TRANSPORTED, RETAIL_RECEIVED, FOR_SALE, CANCELLED, DAMAGED, REJECTED
Bảng User accountStatus
ACTIVE, LOCKED
Bảng Organization
ACTIVE, INACTIVE
# Đề xuất
Bảng Device 
ACTIVE, INACTIVE
Lưu ý: Nếu sinh thêm luồng giải quyết tổ chức cung cấp thiết bị và xảy ra việc thu hồi thiết bị đề xuất thêm trạng thái REVOKED
Bảng IdempotencyRecord
PROCESSING, COMPLETED, FAILED
Giải thích
PROCESSING: request đang xử lý.
COMPLETED: thành công
FAILED: Thất bại
Bảng BlockChainProof
PENDING, SUBMMITTED, CONFIRMED, FAILED
luồng: PENDING -> SUBMITTED -> CONFIRMED OR FAILED
# Giải thích các bảng mới được đề xuất
Role
Quản lý các vai trò trong hệ thống
các field: roleId, code, name, description
dữ liệu bao gồm: SYSTEM_ADMIN, FARM_STAFF, TRANSPORTER, RETAILED, AUDITOR
một Role có thể chưa cấp hoặc cấp cho nhiều user. User chỉ có đúng 1 role (Theo tài liệu nghiệp vụ cung cấp).
Device
Quản lý các thiết bị IoT được phép gửi dữu liệu, dùng để kiểm tra các thiết bị đã được đăng ký có đang hoạt dộng.
field: deviceId, deviceCode, organizationId, batchId, name, type, status, createdAt, updatedAt.
deviceCode: mã của thiết bị (UNIQUE)
Type: công dụng chung của các thiết bị đo nhiệt độ .... (Đề xuất: TEMPERATURE, HUMIDITY).
Status: ACTIVE, INACTIVE
IDEMPOTENCYRECORD
Hạn chế một request nghiệp vụ bị xử lý nhiều lần khi gặp sự cố từ frontend, device, hoặc service.
field:
idempotencyRecordId: khoá chính bản ghi
idempotencyKey: Mã nhận diễn thực hiện request
openration: Tên của nghiệp vụ, example CREATED_TÊN NGHIỆP VỤ Shipmment
requesterId: ID của user, device hoặc service gửi yêu cầu.
requestHash: băm nội dung yêu cầu phát hiện với key nhưng khác dữ liệu,
Status: trạng thái xử lý request.
responseStatus: HTTP status của response
responseBody: Nội dung của response cũ dưới dạng json
ResourceId: ID đối tượng được tạo, ví dụ như shipmentId
CreatedAt, updatedAt, expiresAt.