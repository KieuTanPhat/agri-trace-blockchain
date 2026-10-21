# Đăng ký doanh nghiệp và kết nối peer

> **Trạng thái tài liệu:** các bước sáu phần và quy tắc dịch vụ trong phần dưới là
> baseline thiết kế ngày 15/10, không mô tả đầy đủ implementation hiện tại.
> Form đăng ký hiện có năm bước. Thanh toán mô phỏng chỉ chuyển đơn sang
> `PAID_SIMULATED` và xếp hàng email; SYSTEM_ADMIN kích hoạt dịch vụ bằng command
> riêng trước khi cấp quyền doanh nghiệp. Đối chiếu source hiện hành tại
> [PROJECT_CONTEXT](../PROJECT_CONTEXT.md) và [quy tắc nghiệp vụ](../core-business-rules.md).

Phạm vi bắt đầu ngày 15/10/2026 theo yêu cầu chủ dự án. Nền tảng là main
`7c8e985` và bản sửa commitment c2. Đây là kế hoạch phát triển, không phải biên bản
nghiệm thu hoặc tuyên bố đã triển khai production.

Kế hoạch có một mục tiêu triển khai: doanh nghiệp tự đăng ký, chọn peer được quản
lý hoặc tự vận hành, rồi được kết nối sau xét duyệt và kiểm chứng Fabric. Tên
“v1” chỉ phạm vi hiện tại có bước operator chuẩn bị hạ tầng; không xác định thêm
bản v2/v3 hoặc cho phép dừng trước các mục acceptance bên dưới.

Các bước là xây dựng và kiểm thử cách ly, nghiệm thu hai VPS thật và tài nguyên,
sau đó review/triển khai production. Thiếu VPS doanh nghiệp chỉ để ngỏ những
kiểm chứng cần host đó; phần source, CI, recovery và chuẩn bị vận hành vẫn tiếp
tục. Tự mua VPS, billing và mở rộng tùy ý số tổ chức là các nhu cầu mở rộng riêng,
không phải điều kiện để hoàn thành luồng đã yêu cầu.

## Luồng v1 — baseline thiết kế ban đầu

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
- Chủ dự án đã cho phép dùng VPS production và VPS `enterprise-demo` để nghiệm
  thu hai máy rồi triển khai. Sao lưu nhất quán và kiểm chứng khôi phục trước
  migration/lifecycle; giữ lịch sử production. Không chạy harness pilot có cleanup
  vào DB/mạng đang phục vụ. Peer doanh nghiệp dùng CA/khóa riêng; thay đổi trust,
  endpoint, quota và resource catalog phải được review. Capacity admission precedes startup.
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

## Bổ sung phạm vi local theo quyết định ngày 17/10/2026

Yêu cầu hiện tại mở rộng theo hướng web truy xuất: sản phẩm, vùng sản xuất,
vụ/nhật ký, lô nguồn, quá trình phân phối và tra cứu QR. Quản trị tài khoản,
nhóm quyền, đối tác, cơ sở và phương tiện hỗ trợ truy xuất. Không thêm kế toán,
đơn bán hàng, thanh toán/công nợ hàng hóa, nhân sự hoặc tối ưu kho/đội xe.

Đăng ký mới có sáu bước và bản nháp không lưu mật khẩu, mã OTP hoặc proof xác thực.
Hồ sơ mới bắt buộc đủ thông tin và địa chỉ chọn theo danh mục tỉnh/xã hai cấp;
API kiểm mã và quan hệ tỉnh/xã. Chỉ phần số nhà, đường, thôn/ấp nhập tay. Xác thực
OTP email doanh nghiệp và email quản trị viên (một lần nếu trùng email) trước khi
gửi hồ sơ. Giữ hồ sơ lịch sử nguyên trạng; không tiếp tục nhận đăng ký thiếu hồ sơ.

Theo yêu cầu bổ sung cùng ngày, admin duyệt hồ sơ rồi gửi email chọn gói/mô hình
peer, điền thông tin thanh toán và xem trước hợp đồng. Chủ hồ sơ xác nhận snapshot
hợp đồng rồi có thể ghi nhận thanh toán mô phỏng local. Lệnh này chỉ chuyển đơn
sang `PAID_SIMULATED`, ghi audit và xếp hàng email hợp đồng; nó không cấp quyền.
SYSTEM_ADMIN kích hoạt dịch vụ bằng command riêng để cấp capability/quyền tổ chức.
Kích hoạt hiện không xác minh thanh toán thật (`paymentVerified=false`); cả thanh
toán và kích hoạt đều không chứng minh kết nối Fabric. Hồ sơ đã cấp quyền trước
luồng này giữ chính sách lịch sử, không tự tạo hợp đồng/thanh toán giả.
Ba gói giá tham khảo cấu trúc khởi tạo/duy trì của iCheck, ghi nguồn và ngày giá;
phí QR/hạ tầng peer tách riêng. Chưa có thu tiền, chữ ký số hợp đồng có chứng thư,
hóa đơn hay cổng NAPAS/QR thật. Mô phỏng chỉ bật riêng trên local, không hoạt động
với NODE_ENV=production. Kết nối Fabric vẫn cần kiểm chứng, thanh toán không thay
thế admission hay bằng chứng peer. SMTP Worker hỗ trợ STARTTLS; hộp thư Mailpit
giữ email kiểm thử. Không đưa thông tin SMTP thật vào source/evidence.
Thành viên cấp 2/3 nằm trong cùng doanh nghiệp; cấp 2 chỉ cấp tiếp quyền/phạm vi
đang có cho cấp 3. Thành viên bị thu hồi mất phiên ngay. Các chức năng có route
riêng theo frontend guide, không gom form sản xuất/giao nhận/quản trị vào một trang.

Nhà phân phối là capability riêng. Mỗi chặng gồm bên giao, vận chuyển và nhận;
mỗi dòng giữ lotId và đơn vị nguồn, không tạo lô trộn/chế biến. Holding và lượng
đã dành giao được đối soát bằng Decimal và SQL guard trong cùng transaction với
event/outbox/journal. Ba bên đồng thuận rồi ký hai phía cho lấy/nhận hàng.
Nhật ký thủ công, cảnh báo công khai và ghi giảm lượng bán/hao hụt có lịch sử
riêng. QR chỉ chiếu đúng lô nguồn và không lộ hồ sơ pháp lý, nhân viên hoặc các
dòng lô khác của chuyến ghép.

Acceptance local gồm đăng ký/xét duyệt, quyền 1–2–3 và thu hồi, danh mục theo
doanh nghiệp, nhật ký/thu hoạch, nhà phân phối nhận 1.000 kg rồi giao 600/400 kg,
giao vượt lượng/concurrency/replay/chữ ký sai, QR riêng tư và viewport
320/390/768/1440 px. Evidence từng lần ở artifact local; ảnh vào
`screenshots/DD-MM-YYYY/` theo giờ Việt Nam và không đưa vào Git.

Chỉ làm trên stack/database/network/volume review riêng; giữ demo hiện hành.
Không truy cập GitHub, chạy CI/CD, SSH hoặc production trong tác vụ local này.
Các acceptance VPS/Fabric ở phần kế hoạch trước vẫn cần môi trường tương ứng.
Receipt phân phối mới không thay signing intent c2: API từ chối tạo luồng mới
trên DUAL_SIGNED cho đến khi hoàn tất integration và nghiệm thu Fabric cách ly.

## Điều chỉnh form theo quyết định ngày 18/10/2026

Thay luồng sáu bước ở quyết định 17/10 bằng năm bước: Doanh nghiệp → Đại diện &
tài khoản → Hoạt động → Dịch vụ sử dụng → Kiểm tra & xác minh. Trường ngắn chia
hai cột desktop, trường dài cả hàng; mobile chuyển một cột. Gộp liên hệ với tài
khoản và đưa giới thiệu vào mục tùy chọn, không thêm bước sản phẩm/hành trình/QR
khi chưa được duyệt.

Nhánh doanh nghiệp/HTX/hộ kinh doanh yêu cầu mã số thuế, số đăng ký và file đăng
ký. Hộ nông dân/cá nhân sản xuất không bị ép có giấy đăng ký doanh nghiệp hoặc
CCCD; được bỏ mã số thuế và phải chọn Nhà sản xuất. Chỉ triển khai lĩnh vực
trồng trọt theo mô hình hiện hành. Người được ủy quyền phải tải giấy ủy quyền;
khai chứng nhận phải có file minh chứng. Các file được tải thật bằng proof email
quản trị viên và chỉ chủ hồ sơ/SYSTEM_ADMIN tải được sau khi gửi. Giữ lịch sử
nguyên trạng; không sửa migration đã áp. Dọn file tải dở theo thời hạn chưa có
tác vụ tự động, cần quyết định chính sách lưu giữ trước triển khai thực tế.

Dịch vụ sử dụng lưu lựa chọn, snapshot hợp đồng và trạng thái thanh toán mô phỏng;
không tự ký hợp đồng có chứng thư, thu tiền thật hoặc tự cấp quyền. Quyền được
cấp qua command kích hoạt riêng của SYSTEM_ADMIN. Tách ba xác nhận bắt buộc về
thông tin/điều khoản/quyền riêng tư và tùy chọn tiếp thị mặc định tắt. Nội dung
`/terms`, `/privacy` đang ở trạng thái chủ dự án review. Hồ sơ lưu phiên bản nội
dung và thời điểm xác nhận từ server. Bổ sung sau (18/10/2026): hồ sơ bị từ chối hoặc thay đổi
pháp lý/năng lực sau duyệt được gửi lại bằng bản điều chỉnh có giấy tờ riêng tư
và admin duyệt; liên hệ/giới thiệu lưu revision; xem
[kế hoạch chức năng nghiệp vụ](agritrace-business-functions-implementation.md).

Theo review tiếp theo, form dùng khổ ngang rộng và báo lỗi dưới từng trường,
không cuộn lên tiêu đề khi nhập sai. Bước tài khoản kiểm tra email đăng nhập đã
tồn tại trước khi cho qua; final signup vẫn kiểm uniqueness nguyên tử. Dịch vụ
Truy xuất nguồn gốc bắt buộc, Tem QR theo lô tùy chọn, bỏ hai lựa chọn Quản lý
sản xuất và Phân phối khỏi đăng ký mới. Bản rà soát dùng mục nhãn/giá trị đầy đủ,
bỏ logo phụ và khối hướng dẫn xác thực; nút bắt đầu đổi thành “Xác thực tài
khoản”. Chỉ bỏ dòng hướng dẫn OTP trên UI, giữ các giới hạn hiện hành ở backend.
