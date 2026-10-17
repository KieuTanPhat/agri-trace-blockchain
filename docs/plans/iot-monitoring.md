# Triển khai giám sát IoT theo chuyến

Nguồn yêu cầu: bộ tài liệu giao việc IoT v1.2 ngày 16/10/2026 do chủ dự án cung
cấp. Checkout tham chiếu khi chuẩn bị là `eed1a70`; đây chưa phải tuyên bố
nghiệm thu onboarding trên hai VPS. Chủ dự án đã yêu cầu tiếp tục triển khai
local dù chưa có xác nhận baseline. Không dùng việc thiếu xác nhận để chặn
phát triển; nghiệm thu runtime vẫn phải ghi bằng chứng riêng.

## Phần source đã chuẩn bị

- `iot/wokwi`: mạch và firmware độc lập, chưa có adapter API.
- Module IoT có các hàm thuần: chuẩn hóa policy, đánh giá toàn tập mẫu,
  chuẩn bị/kiểm lại digest v2, bản tổng hợp để người nhận xem, quyết định chốt
  thiếu, kiểm verifier credential, phân biệt liên lạc và độ mới của số đo.
- Migration `20261022000000_iot_device_credentials` thêm source/version và
  credential bất biến; trigger tăng authority khi cấp/xoay/thu hồi, cấm đổi
  chủ sở hữu/nguồn và xóa lịch sử credential.
- API tài sản kiểm ORG_ADMIN, enrollment APPROVED, tổ chức ACTIVE và capability
  TRANSPORTER dưới khóa; version/idempotency/journal cùng transaction.
- Cả hai đường device-readings và device-telemetry dùng credential riêng;
  không còn fallback `IOT_INGEST_API_KEY`. Context xác thực được kiểm lại khi
  ghi, replay và inspection. `POST /iot/device-commands/status` đối soát bằng
  cùng deviceId, key và payload gốc, không thực thi command mới.
- Web `/enterprise/devices` đọc API, đăng ký/đổi trạng thái và quản lý
  credential. Browser tạo secret 32 byte, chỉ gửi verifier; secret nằm trong
  memory và chỉ hiện khi xác định command thành công. Recovery lưu body có
  verifier nhưng không lưu token. Reload mất secret thì đối soát command cũ
  trước khi xoay credential; không tạo key mới để né kết quả chưa rõ.
- Test dùng PostgreSQL cách ly và dữ liệu tổng hợp; không thay thế nghiệm thu
  Fabric/Wokwi runtime hoặc deployment.

Các hàm policy/evaluator/evidence/lifecycle **chưa nối vào luồng chuyến**.
Chưa có migration session, heartbeat, alert, seal hoặc receipt review; firmware
chưa gửi HTTPS. Chưa đánh dấu luồng IoT theo chuyến hoàn tất.

## Contract tài sản và chuyển đổi credential

Đường dẫn bên dưới có prefix `/api`; contract chi tiết sinh từ NestJS Swagger.

- `GET /iot/devices/managed`: ORG_ADMIN xem tối đa 200 thiết bị của tổ chức.
- `POST /iot/devices`: body mới `{deviceCode, name, sourceType: WOKWI_SIMULATED}`;
  tổ chức lấy từ actor, không nhận organizationId/cycleId/type tùy ý như API cũ.
- `PATCH /iot/devices/:deviceId/status`: status và version dự kiến.
- `GET /iot/devices/:deviceId/credentials`: metadata, không trả verifier/token.
- `POST /iot/devices/:deviceId/credentials`, `/credentials/rotate`: version,
  credentialId, verifier và expiresAt; API giới hạn hạn dùng không quá 2 giờ.
- `POST /iot/devices/:deviceId/credentials/:credentialId/revoke`: version.
- Mutation tài sản dùng Idempotency-Key và endpoint `/command-requests/status`
  hiện có; response replay chỉ chứa metadata, không phục hồi secret.

Trước rollout phải kiểm kê thiết bị lịch sử ở cả hai đường ingest. Chưa có UI
provision credential cho thiết bị FARM lịch sử; không bật release lên môi
trường còn dùng khóa chung khi chưa hoàn tất phương án chuyển đổi đó. Các
biến khóa chung trong bundle deployment cũ không còn có tác dụng xác thực.
Không tự đổi source UNKNOWN thành mô phỏng hoặc thiết bị thực.

## Quyết định kỹ thuật cần review cùng migration/contract

Đây là candidate phục vụ review IO02/IO03; không rehash dữ liệu cũ.

- `shipment-monitoring-policy-1` commit mode và policy đã chuẩn hóa. Kế hoạch
  NONE không có policy; ENABLED phải có ngưỡng hợp lệ, interval 10 giây.
- Nhiệt/ẩm chuẩn hóa Decimal tối đa 3 chữ số như precision hiện tại; từ chối
  làm tròn mẫu đầu vào. Tổng dùng integer millidegrees. Average hiển thị 3
  chữ số, làm tròn half-away-from-zero; phép tính này phải giữ theo version.
- Thứ tự membership là recordedAt UTC millisecond rồi sampleId. UUID ở tập
  mẫu dùng dạng canonical lowercase. Trùng row/sample hoặc sai
  session/device/shipment/window bị từ chối, không tự lọc âm thầm.
- Excursion dùng thời điểm đo, ngưỡng bao gồm hai biên. Một chuỗi ngoài ngưỡng
  phải đủ duration; gap lớn hơn 2 interval (20 giây) cắt chuỗi. Duration chỉ
  tính giữa các mẫu ngoài ngưỡng có bằng chứng, không kéo dài tới cutoff hoặc
  mẫu bình thường kế tiếp. Gap đầu/cuối phiên được thể hiện riêng.
- Digest candidate `shipment-telemetry-digest-2` dùng RFC8785/SHA-256 hiện
  có. Commitment chứa snapshot/session/plan/revision/policy/source/window,
  completeness, toàn bộ membership đã chuẩn hóa và summary tính lại.
  NO_DATA có count 0/hash null; không tạo digest row giả.
- Verifier nhận snapshot từ session/plan bất biến, raw từ DB và evidence
  lưu riêng; so lại toàn bộ payload/summary/hash. Nó không tự kiểm Fabric
  proof và không đủ nếu caller lấy snapshot từ chính payload đang bị kiểm.
- Review hash gắn shipment/plan/session, summary, completeness và source;
  không chứa heartbeat live, proof progress hoặc notes. Candidate helper
  hiện hỗ trợ NONE và phiên đã chốt. Phiên chưa chốt và cảnh báo offline
  phải được bổ sung vào projection trước khi nối command receive.
- Credential candidate dùng `credentialId.secret`, secret base64url canonical
  32–64 byte; browser SHA-256 UTF-8 của **secret text**. Server so verifier
  constant-time, không nhận secret trong body/journal. Encoding phải thống
  nhất với export cấu hình Web và firmware khi contract được review.

## Trình tự tích hợp còn lại

1. Tiếp tục phát triển trên DB cách ly; đối chiếu Issue AGT và bổ sung evidence
   baseline khi nghiệm thu runtime, không dùng nó làm điều kiện dừng code.
2. Review migration append-only: source/version thiết bị, credential,
   policy theo revision, session, heartbeat, alert/actions, sealed membership,
   receipt review. Kiểm direct SQL, migration lịch sử và restore.
3. Nối asset commands với ORG_ADMIN/capability và device auth với
   credential context; kiểm quyền dưới khóa trước ghi/replay/inspection.
4. Nối session/ingest/finalize, journal/trace/outbox nguyên tử dưới Lot lock.
   Tích hợp evaluator với alert revisions append-only và stale tick 10 giây,
   unique constraints cho nhiều API instance. Tính lại toàn phiên khi backfill.
5. Version payload ShipmentPlan, consent và receive; giữ DUAL_SIGNED, quantity
   và history. Review snapshot phải được tính/lưu trong transaction receive.
6. Sinh Swagger/types rồi nối Web và HTTPS firmware. Chạy toàn bộ ma trận
   nghiệp vụ, quyền âm, đồng thời/recovery, QR allowlist, managed/self-managed.
7. PR/review và release theo runbook production, ghi evidence đúng candidate.

Không đánh dấu IO02/IO03 hoàn tất chỉ vì các hàm thuần hoặc unit test đã có.
Kết quả từng lần chạy nằm ở artifacts/PR; không đưa receipt riêng tư vào Git.
