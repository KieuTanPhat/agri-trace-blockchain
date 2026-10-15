# Đăng ký doanh nghiệp và kết nối peer

Phạm vi bắt đầu ngày 15/10/2026 theo yêu cầu chủ dự án. Nền tảng là main
`7c8e985` và bản sửa commitment c2. Đây là kế hoạch phát triển, không phải biên bản
nghiệm thu hoặc tuyên bố đã triển khai production.

## Luồng v1

1. Doanh nghiệp đăng ký người đại diện, mã doanh nghiệp, hoạt động chính và chọn
   MANAGED_ORG hoặc SELF_MANAGED_ORG. Không tự đăng ký quyền kiểm định/Admin.
2. Tạo account/organization/hồ sơ trong một transaction. Chưa cấp capabilities,
   ORG_ADMIN/CREATE_CHAIN hay business grants. Đăng nhập để xem hồ sơ chờ duyệt.
3. Quản trị nền tảng duyệt thông tin doanh nghiệp. Duyệt cấp capability hoạt động
   đã khai và quyền ORG_ADMIN/CREATE_CHAIN; business writes vẫn cần membership,
   assignment, consent và grant đúng scope như hiện tại.
4. Người đại diện tự tạo chuỗi và gửi yêu cầu kết nối. Managed không nhập thông
   tin peer. Self-managed chỉ gửi endpoint, tên TLS, MSP và chứng thư CA công khai;
   giữ toàn bộ khóa riêng trên VPS của doanh nghiệp.
5. Quản trị duyệt yêu cầu; operator chuẩn bị mạng/binding/chaincode và khai báo
   inventory đã review cho Worker. V1 có operator thực hiện admission và
   lifecycle Fabric; không tự mua VPS hoặc tự tin cậy mọi endpoint từ web.
6. Worker so khớp inventory với yêu cầu và binding thuộc đúng chuỗi/doanh nghiệp.
   Giao dịch kiểm tra cần endorsement của writer và owner theo policy. Đọc cùng
   proof từ peer doanh nghiệp và platform, kiểm VALID rồi mới báo CONNECTED.

## Ranh giới hạ tầng

- Pilot hiện có Org1/2/3 và hai channel cố định. V1 dùng một MSP độc quyền cho
  một doanh nghiệp trong từng network; inventory không được ánh xạ hai doanh
  nghiệp vào cùng network/MSP. Đưa thêm tổ chức cần provisioning/channel lifecycle
  được review hoặc một network độc lập; không sửa governance đã ghim để lách.
- Managed do platform vận hành. Self-managed dùng gói peer cài tại host doanh
  nghiệp; public MSP/TLS chuyển sang operator, admin/CA/signing keys ở host đó.
- Không chạy pilot test vào mạng/DB production. Demo hai máy dùng tài nguyên
  có tên, mạng, CA, volume và binding riêng. Capacity admission precedes startup.
- Tự động hóa provisioning đa doanh nghiệp không giới hạn và cloud billing nằm
  ngoài v1. UI phải thể hiện rõ bước chờ vận hành; không báo tự cấp peer xong.

## Bất biến và recovery

- Đăng ký dùng request UUID cùng HMAC nội dung để retry, không lưu mật khẩu hoặc
  verifier không khóa trong receipt. Email và mã doanh nghiệp duy nhất.
- Approval và connection commands dùng journal/idempotency hiện có, kiểm quyền
  hiện hành trước replay và dưới khóa transaction. Ghi audit decision/revision.
- Yêu cầu và challenge bất biến. Lưu txId trước traffic. Sau trạng thái UNKNOWN
  chỉ đối soát giao dịch cũ; không thay challenge/key để gửi mù. Kết quả lỗi xác
  định trước broadcast/INVALID cho phép tạo yêu cầu mới sau xử lý.
- CONNECTED là kết quả kiểm chứng tại checkedAt, không phải SLA hoặc health
  liên tục. Lỗi mạng trong nghiệp vụ vẫn đi qua outbox/circuit breaker.
- API không nhận Fabric private key và không dial endpoint do user tùy ý nhập.
  Chỉ Worker có technical writer identity đọc inventory ngoài Git.

## Acceptance

- [ ] Registration qua HTTP, duplicate/retry, mật khẩu Unicode, escalation bị chặn.
- [ ] Owner chỉ đọc hồ sơ mình; admin duyệt một lần với version/journal; revoke
  trước replay chặn; signup chưa được duyệt không ghi nghiệp vụ/tạo chuỗi.
- [ ] Managed và self-managed tạo yêu cầu riêng; private key/URL injection,
  endpoint chưa duyệt, sai scope/binding/MSP đều bị chặn trước kết nối.
- [ ] Worker giữ lease, lưu txId, đối soát mất response; không báo CONNECTED
  chỉ vì health OK, receipt do browser gửi hoặc phê duyệt UI.
- [ ] Giao dịch probe và business handover commit VALID với owner endorsement;
  thiếu peer owner, revoked credential, sai channel bị từ chối trên Fabric thật.
- [ ] Web đăng ký, trang doanh nghiệp và admin hoạt động trên desktop/mobile;
  lỗi mạng giữ yêu cầu gốc; không lưu password/private key vào storage.
- [ ] Demo trên VPS doanh nghiệp riêng: TLS/WAN, join, lifecycle approvals,
  endorsement, restart/recovery và đo tài nguyên. Chưa có VPS thứ hai thì mục này
  giữ NotEvaluated; không thay bằng kết quả Docker một máy.
- [ ] PR/CI đúng SHA, migration/lifecycle review, backup/restore và smoke VPS
  trước khi bật tính năng production. Chủ dự án quyết định thời điểm rollout.

Kết quả từng lần chạy ở artifact local hoặc PR/Issue; không chép số test thành
acceptance sản phẩm trong kế hoạch này.
