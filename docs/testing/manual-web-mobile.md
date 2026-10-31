# Bộ dữ liệu và phiếu test giao diện Web/mobile

Cập nhật 29/10/2026. Đối chiếu source đang sửa trên nhánh
`feature/mobile-auth-rebuild`, HEAD `7cf81b5` cộng working tree.

**Đây là dữ liệu đầu vào và kết quả mong đợi, chưa phải kết quả chạy UI.**
Admin A0 đã được bootstrap riêng trên DB UI-test; các doanh nghiệp, nhân viên
và mã vụ còn lại chưa được nạp. Không đăng nhập bằng các email đề xuất chưa tạo. Dữ liệu toàn bộ là giả
lập, chỉ dùng local; không là hồ sơ pháp lý/chứng nhận sản phẩm thật.

## Trạng thái chuẩn bị mới nhất — 29/10/2026

- DB local `agri_trace_ui_test` đã chạy đủ 93 migration; backend `.env` đã chuyển
  sang DB này. DB `agri_trace_mobile` cũ giữ nguyên.
- A0 `ui.admin@example.test` đã tạo, bcrypt cost 12, ACTIVE, không thuộc doanh
  nghiệp và bắt đổi mật khẩu lần đầu. Mật khẩu ngẫu nhiên lưu riêng trong file
  bị Git ignore `.codex/ui-test-admin.json`, quyền file 0600; không chép vào tài liệu.
- Đã kiểm tra HTTP login local cổng 8084 trả 201 với role SYSTEM_ADMIN và
  mustChangePassword=true; phiên kiểm tra đã logout. Chưa đánh PASS cho UI hoặc
  thao tác đổi mật khẩu của người dùng. Các bài trong phiếu vẫn NOT_RUN.
- Hộp thư local đã chạy tại `http://localhost:8025`, container
  `agritrace-ui-mailpit` chỉ bind loopback; Worker local chạy cổng health 8085
  (tránh Metro 8081). Đã kiểm REGISTRATION_OTP chuyển PENDING → SENT và thư
  xuất hiện trong Mailpit. Đây là local delivery, không phải Gmail/SMTP thật.
  Email OTP và mật khẩu tạm cho các bước tiếp theo xem ở Mailpit; không chép mã
  vào source/phiếu kết quả. Mailpit dùng volume `agritrace-ui-mailpit-data`.
  Khi chạy lại: `docker start agritrace-ui-mailpit`; Worker chạy riêng từ root:
  `WORKER_HEALTH_PORT=8085 npm run start:worker:prod --workspace apps/api` sau
  khi API đã build; cấu hình mail/DB local nằm trong `apps/api/.env` bị Git ignore.
- Bootstrap local: `CONFIRM_UI_TEST_DATABASE=agri_trace_ui_test node --import tsx
  scripts/bootstrap-ui-admin.mts` từ `apps/api`. Chỉ hỗ trợ DB local đúng tên,
  đủ migration, chủ sở hữu đúng và chưa có user. **Không chạy lại khi đã có admin**;
  script không đổi/reset credential. Bootstrap production là luồng khác.

## 0. Cổng chuẩn bị — kiểm tra ban đầu trước khi tạo DB UI-test

Đã kiểm tra chỉ đọc local ngày 29/10:

- Cổng 8080 do `iot_n20-backend-1` sử dụng, **không phải AgriTrace**. Không dừng
  container IoT và không trỏ mobile AgriTrace tới cổng này.
- `apps/api/.env` trỏ PostgreSQL `localhost:5432/agri_trace_mobile`.
  Database có dữ liệu cũ; migration mới nhất đã hoàn tất là
  `20261023000000_consumer_phone_auth`, chưa khớp source hiện tại.
- Chưa có Web lắng nghe cổng 3000 ở lượt kiểm tra. Chưa chạy migration, reset,
  seed hoặc sửa tài khoản của database này để chuẩn bị tài liệu.

Chuẩn bị theo thứ tự:

1. Sao lưu DB local hiện có và kiểm tra backup đọc được. Đối chiếu migration theo
   [runbook database](../database-migration-runbook.md); nếu guard phát hiện dữ
   liệu ledger legacy thì dừng để đối soát, không xóa lịch sử để vượt guard.
2. Cập nhật DB trên đúng target đã xác minh, kiểm tra API khởi động với source mới.
   Không dùng `seed-current.ps1 -ReplaceCurrentData`, `db push --force-reset`,
   TRUNCATE hoặc seed cũ để chuẩn bị bài test này.
3. Dùng cổng trống riêng cho AgriTrace, ví dụ **8084** (kiểm tra trước khi dùng).
   Cấu hình Web và mobile cùng API `http://<IP-Mac>:8084/api`; Web trên Mac có thể
   dùng `http://127.0.0.1:8084/api`. Web trace trên điện thoại phải là
   `http://<IP-Mac>:3000`, không phải localhost của điện thoại.
4. `ENTERPRISE_PAYMENTS_ENABLED=false`: admin duyệt rồi kích hoạt dùng tạm.
   Môi trường này dùng ledger mô phỏng nếu đã cấu hình đúng binding; không giả
   bằng chứng Fabric. Không bật SMS thật chỉ để vượt bài test.
5. Tạo/cấp tài khoản test theo bảng dưới bằng bootstrap được kiểm soát và các
   luồng thành viên/onboarding hiện hành. Không sửa role/hash trực tiếp tùy tiện.
   SMTP dùng local mail sink cho email thử nghiệm; nếu chưa có sink thì đánh dấu
   bài email/OTP **BLOCKED**, không nhập OTP đoán hoặc nói email đã gửi thành công.
6. Đăng nhập các bên ký ở các **browser profile riêng** và đăng ký khóa tổ chức
   đúng luồng `/enterprise/signing`. Không copy khóa riêng/token giữa các bên.
7. Ghi URL Web/API, tên DB, phiên bản APK, IP Mac, thời điểm T và ID tạo thực tế
   vào phiếu kết quả. Chỉ bắt đầu khi Web/API/mobile dùng cùng môi trường.

T là ngày/giờ thực tế lúc test theo Việt Nam. Ngày bắt đầu vụ dùng T−2 ngày;
ngày dự kiến thu hoạch T+7 ngày. Giờ nhật ký/thu hoạch dùng giờ hiện tại hoặc sớm
hơn hợp lệ, không nhập giờ tương lai và không dùng cố định ngày trong tài liệu.

## 1. Tài khoản và phạm vi cần chuẩn bị

A0 đã được tạo theo trạng thái trên; các email còn lại là **đầu vào đề xuất**,
chưa phải tài khoản có sẵn.
Mật khẩu lấy từ thư mời/mật khẩu tạm thực tế; đổi lần đầu theo UI. Không dùng một
mật khẩu mặc định chung cho mọi tài khoản. Không gửi SMS đến số điện thoại giả.

| Mã | Email đề xuất | Tổ chức / cấp | Mục đích |
|---|---|---|---|
| A0 | ui.admin@example.test | SYSTEM_ADMIN | Duyệt/kích hoạt, không ghi nhật ký thay doanh nghiệp |
| F1 | ui.farm.owner@example.test | `[UI-TEST] HTX Rau A` / C1 | Chủ HTX |
| F2 | ui.farm.manager@example.test | HTX A / C2 | Quản lý vùng/vụ được cấp |
| F3 | ui.farm.worker@example.test | HTX A / C3 | Chỉ được giao vụ A |
| FX | ui.other.worker@example.test | `[UI-TEST] HTX Rau B` / C3 | Kiểm tra khác doanh nghiệp |
| T1 | ui.carrier.owner@example.test | `[UI-TEST] Vận chuyển T` / C1 | Đồng thuận/lấy/giao hàng theo quyền |
| D1 | ui.distributor.owner@example.test | `[UI-TEST] Phân phối D` / C1 | Tham gia chuỗi, nhận hàng |
| R1 | ui.retail.owner@example.test | `[UI-TEST] Bán lẻ R` / C1 | Nhận hàng, bán theo quyền |
| P1 | ui.processor.owner@example.test | `[UI-TEST] Chế biến P` / C1 | Nguyên liệu ngoài, mẻ và thành phẩm |
| G0 | Không đăng nhập | ACheck khách | QR và dữ liệu công khai |
| C0 | Số Firebase test được cấu hình hoặc số của chính bạn | Consumer riêng | Đăng ký/quên mật khẩu; không dùng email nhân viên |

C2 có nhóm quyền đúng vùng/chuỗi/cơ sở để thực hiện việc được giao; C3 không có
quyền quản lý thành viên/nhóm quyền hay toàn doanh nghiệp. Cả cấp và chain grant,
capability, membership, assignment phải hợp lệ; tên role không tự tạo đủ quyền.
Admin duyệt tất cả năng lực cần thiết rồi **kích hoạt riêng**; duyệt hồ sơ không
được hiểu là đã thanh toán. Các bên tham gia chuỗi phải chấp nhận lời mời và có
grant, phân công/cơ sở đúng luồng; không chỉ xuất hiện trong danh bạ đối tác.

## 2. Dữ liệu nhập nhỏ, có thể đối soát

Mỗi lượt chạy thêm hậu tố `R01`, `R02`… để tránh trùng. Không xóa lượt cũ.
ID chọn từ dropdown hoặc ID do hệ thống trả về; **không tự chế UUID/QR**.

| Đối tượng | Giá trị nhập cho R01 |
|---|---|
| Vùng/nông trại HTX A | `[UI-TEST-R01] Vườn rau A` |
| Thửa thuộc vùng | `[UI-TEST-R01] Thửa A1`; diện tích 100 theo đơn vị UI ghi rõ |
| Sản phẩm A | `[UI-TEST-R01] Cải xanh`; đơn vị thu hoạch `kg` |
| Sản phẩm chế biến | `[UI-TEST-R01] Rau sơ chế`; đơn vị `kg` |
| Sản phẩm kiểm đơn vị riêng | `[UI-TEST-R01] Dầu thực vật`; đơn vị `lít`, dùng chuyến độc lập hoặc nguồn hợp lệ khác |
| Chuỗi | `[UI-TEST-R01] Rau A → T → D → R`; cấp quyền/đồng thuận cho các bên thực sự tham gia |
| Vụ A | `[UI-TEST-R01] Vụ cải A`; mã `UI-R01-A`; vùng/thửa/sản phẩm A, diện tích 100; tối đa 100 kg; giao F3 |
| Vụ B cùng HTX A | `[UI-TEST-R01] Vụ cải B`; mã `UI-R01-B`; giao F2, **không giao F3** |
| Cơ sở | `[UI-TEST-R01] Kho A`, `Kho T`, `Kho D`, `Kho R`, `Xưởng P` đúng tổ chức |
| Nhật ký F3 | Loại `Tưới nước`; việc `Tưới nhỏ giọt 30 phút`; ghi chú `[UI-TEST-R01] Ghi nhận thử nghiệm` |
| Ảnh | Chụp tờ giấy ghi `[UI-TEST-R01] ẢNH THỬ NGHIỆM`; ảnh nhật ký, thu hoạch và lô riêng, đúng JPEG/PNG |
| Thu hoạch lần 1 | **20 kg**; ghi lại Lot ID/mã lô/QR thật thành `L1` |
| Thu hoạch lần 2 | **30 kg**; ghi lại lô khác thành `L2` |
| Chuyến G1 | Lấy từ L1 **12.000 kg**, từ Kho A → Kho D, bên vận chuyển T; ghi chú `[UI-TEST-R01] Giao đủ` |
| Chuyến G2 | Lấy từ L2 **5.000 kg**, chỉ dùng bài hủy trước lấy hàng |
| Nguyên liệu ngoài cho P | Phiếu `[UI-TEST-R01] NL-P`; **10.000 kg**; nhà cung cấp `[UI-TEST] NCC ngoài`; ảnh thử nghiệm |
| Mẻ P | `[UI-TEST-R01] Sơ chế P`; dùng 10 kg từ NL-P; ra **8.000 kg**, hao hụt **2.000 kg** |

Giữ bài giao nhận chính đơn giản: nhận đủ **12 kg**, hao hụt 0. Không trộn bài
nhận thiếu/trả hàng vào lượt đầu. G2 chỉ giữ chỗ rồi hủy, không làm giảm tồn thực.
Nguyên liệu ngoài 10 kg của P là nguồn độc lập, **không trừ tiếp từ L1/L2**.
Không dựng vụ trồng giả cho nguyên liệu ngoài.

## 3. Phiếu test theo thứ tự

Mỗi dòng ghi PASS/FAIL/BLOCKED/NOT_RUN, ảnh màn hình và ID liên quan. Không đánh
PASS từ việc chỉ nhìn thấy nút hoặc từ test tự động trước đó.

### A. Web: tài khoản, duyệt và quyền

| ID | Thao tác / đầu vào | Kết quả mong đợi |
|---|---|---|
| W01 | Tạo hồ sơ HTX A; dùng liên hệ demo và tài liệu có nhãn TEST, không giả mã số thuế/giấy phép thật | Hồ sơ ở trạng thái chờ đúng bước; không tự hoạt động, không đánh dấu thanh toán |
| W02 | OTP email → nhận mật khẩu tạm → đăng nhập lần đầu | Đúng OTP từ sink mới qua; bắt đổi mật khẩu trước khi vào chức năng nghiệp vụ; mật khẩu tạm cũ không đăng nhập được sau đổi |
| W03 | A0 từ chối với lý do `Bổ sung ảnh giấy tờ thử nghiệm`; F1 sửa và gửi lại | F1 thấy lý do, sửa được phần cho phép; có lịch sử lần nộp; không biến hồ sơ bị từ chối thành active tự động |
| W04 | A0 duyệt hồ sơ/năng lực rồi kích hoạt dùng tạm | Dùng dịch vụ theo quyền; không yêu cầu mua gói, không tạo hóa đơn/paid giả |
| W05 | F1 mời F2/F3, cấp nhóm quyền và giao vụ A cho F3 | F3 chỉ thấy/phát lệnh trên vụ được giao; không mở quản lý thành viên/nhóm quyền; F2 chỉ thao tác phần được cấp |
| W06 | F3/FX mở URL vụ B hoặc vụ của tổ chức khác đã ghi từ phiên chủ | Bị từ chối hoặc không tìm thấy; không lộ nhật ký, ảnh riêng hay dữ liệu vụ khác |
| W07 | A0 thử URL ghi nhật ký/thu hoạch của HTX | Không được ghi thay HTX chỉ vì là admin nền tảng |

### B. Web + mobile nhân viên: vụ → ảnh → nhật ký → lô

Mobile nhân viên dùng variant `staff`, đăng nhập **email** F3 ở `/staff/login`.
Đây khác ACheck consumer đăng nhập bằng số điện thoại. Hai app cần cùng API target.

| ID | Thao tác / đầu vào | Kết quả mong đợi |
|---|---|---|
| M01 | F1 tạo vùng/thửa/sản phẩm, tạo vụ A/B, nối chuỗi và bắt đầu vụ A; F3 mở mobile | F3 thấy vụ A; đúng sản phẩm, mã vụ, vùng và phân công; vụ chưa bắt đầu không mở ghi |
| M02 | Nhật ký thiếu tên việc hoặc thiếu ảnh | Không gửi được; không thêm nhật ký/lệnh chờ |
| M03 | Từ chối quyền camera rồi thử chọn ảnh thư viện có chủ ý | Không crash; chỉ gửi khi đã chọn được ảnh; kiểm thực tế theo hộp thoại OS |
| M04 | Nhập nhật ký ở bảng dữ liệu, chọn ảnh rồi bấm Lưu liên tiếp | Chỉ một nhật ký; Web của F1 thấy đúng nội dung, ảnh riêng tư đúng vụ; không nhân đôi do bấm nhanh |
| M05 | Đang mở form/tải ảnh thì đăng xuất/đổi tài khoản | Draft/ảnh không sang tài khoản mới; form cũ đã đóng không phát tiếp command; lệnh đã gửi trước đó vẫn cần đối soát |
| M06 | Thu hoạch 20 kg với hai ảnh bắt buộc | Tạo đúng L1 và QR; vụ vẫn mở; tổng thu 20/100 kg; Web và mobile cùng dữ liệu |
| M07 | Thu hoạch tiếp 30 kg | Tạo L2 khác L1, QR khác; tổng 50/100 kg; không đóng vụ tự động |
| M08 | Nhập lần tiếp 51 kg hoặc 0/âm/không hợp lệ | Bị chặn; không tạo thêm lô, tổng vẫn 50 kg. Ghi nhận lỗi validation thực tế, không yêu cầu đúng nguyên văn |
| M09 | F1 đóng vụ sau đợt cuối | Vụ kết thúc; không ghi thêm nhật ký/thu hoạch; L1/L2 và QR vẫn tồn tại |
| M10 | F1 thu hồi phân công/quyền F3 khi F3 đang mở vụ | Lần ghi tiếp bị API từ chối, không thêm sự kiện; tải lại không có quyền ghi; không thử lách bằng reload |
| M11 | Tắt mạng **sau khi tải ảnh thành công**, gửi nhật ký trên vụ test còn mở; phục hồi mạng, mở Lệnh chờ gửi và đối soát | Giữ body/key gốc; khi đã commit chỉ hiện đúng một sự kiện; không tự tạo key mới. Nếu tắt mạng trước tải ảnh thì chỉ là lỗi upload, chưa phải bài queue |
| M12 | Lỗi đọc vụ / API tạm không tới được | Có thông báo và nút thử lại; không quay loading vô hạn; không hiện dữ liệu của phiên cũ |

M10/M11 chạy trên vụ phụ còn mở, không chạy sau khi đã đóng vụ A ở M09 nếu muốn
kiểm tra queue thành công. Để nghiệm thu thu hồi khi đang mở form, ưu tiên chạy
M10 trước M09 hoặc tạo vụ riêng `UI-R01-C` được giao F3 rồi thu hồi.

### C. Web ký thật + mobile xem giao nhận

Tiền đề: đối tác/chuỗi/cơ sở/grant hợp lệ; khóa ký mỗi tổ chức đăng ký theo luồng
Web. Chọn đúng G1/G2, không dùng Shipment cùng lúc cho lô đã đi distribution.

| ID | Thao tác / đầu vào | Kết quả mong đợi |
|---|---|---|
| G01 | F1 tạo G1 12 kg từ L1; F1/T1/D1 đồng thuận từng bên | PROPOSED trước đủ đồng thuận, READY sau đủ theo luồng; chưa coi là đã giao; không giảm tồn toàn cục do chỉ giữ chỗ |
| G02 | Thử tạo thêm chuyến 9 kg từ L1 trong lúc G1 đang giữ 12/20 kg | Bị chặn vì chỉ còn 8 kg chưa giữ chỗ; không tạo/chốt chuyến vượt tồn |
| G03 | Trên Web, các bên đúng vai trò ký lấy hàng G1 | Chỉ sau đủ chữ ký của bước mới chuyển IN_TRANSIT; F1 không thể ký thay T1; còn giữ nguyên mã lô L1 |
| G04 | D1 ghi thực nhận 12 kg, hỏng 0, thiếu 0; các bên ký giao đúng bước | DELIVERED; D giữ 12 kg tại cơ sở nhận, A còn 8 kg; global L1 vẫn 20 kg nếu không bán/hỏng; không tạo lô nguồn mới |
| G05 | Mobile T1/D1 → Chuyến hàng → Xem chuyến hàng → Xem lô nguồn | Đúng nơi gửi/nhận, bên tham gia, 12 kg và mã L1; chữ ký metadata hiện đúng; không có nút ký giả trên mobile |
| G06 | Tạo G2 5 kg từ L2 rồi F1 hủy trước lấy hàng | CANCELLED; trả phần giữ chỗ, L2 vẫn 30 kg; không có chữ ký giao hàng giả |
| G07 | Trên chuyến phụ chưa lấy hàng, yêu cầu đồng thuận lại với lý do `Thay đổi lịch lấy hàng thử nghiệm` | Epoch tăng; cần ký lại đúng lượt; mobile không coi chữ ký lượt cũ là chữ ký hiện tại |
| G08 | Xem chuyến có dòng kg và dòng lít từ hai nguồn hợp lệ, nếu môi trường có đủ nguồn | Hiện số dòng hàng/từng dòng đúng đơn vị; không hiển thị tổng kg+lít. Thiếu nguồn hợp lệ: BLOCKED, không đổi unit của lô để dựng bài |
| G09 | Đăng nhập FX hoặc tổ chức không tham gia, mở link G1 | Không đọc được record/ảnh/chữ ký ngoài phạm vi; không ký hoặc nhận hàng được |

Sau G01/G03/G04, chụp màn hình của từng bên trên Web và mobile. Trạng thái
DELIVERED không tự chứng minh Fabric đã xác nhận; ghi riêng trạng thái proof.

### D. Web chế biến — nguyên liệu ngoài

| ID | Thao tác / đầu vào | Kết quả mong đợi |
|---|---|---|
| P01 | P1 tạo NL-P 10 kg với chứng từ/ảnh thử nghiệm và cơ sở Xưởng P | Nguồn 10 kg có bằng chứng, đúng doanh nghiệp; không gắn vụ trồng bịa |
| P02 | Tạo/bắt đầu mẻ P, giữ 10 kg; thử mẻ khác cùng nguồn thêm 1 kg | Mẻ thứ hai không được giữ vượt phần còn khả dụng; không âm tồn |
| P03 | Ra thành phẩm 8 kg, hao hụt 1 kg (tổng 9) | Từ chối vì chưa cân bằng 10; chưa tạo thành phẩm/QR; có thể sửa dữ liệu đầu vào theo UI rồi thử lại |
| P04 | Ra thành phẩm 8 kg, hao hụt 2 kg | Hoàn tất, có một lô thành phẩm và QR; nguồn/mẻ/chain đúng; không lỗi 500 do thiếu vụ gốc |
| P05 | Reload rồi xem lại kết quả; không tạo mẻ thứ hai để thử replay | Vẫn đúng một lô/QR; không trừ nguyên liệu hai lần |
| P06 | Trên nguồn/mẻ phụ, bắt đầu rồi hủy trước hoàn tất | Giải phóng phần giữ nguyên liệu; lịch sử hủy còn; không sinh thành phẩm |

### E. ACheck consumer, session và dữ liệu công khai

| ID | Thao tác / đầu vào | Kết quả mong đợi |
|---|---|---|
| C01 | Khách quét QR thật của L1/L2 | Mở đúng lô, hai QR khác nhau; không lộ email/password/ảnh chứng từ riêng; dữ liệu chưa xuất bản không bị tự công khai |
| C02 | Mã QR không tồn tại hoặc URL ngoài origin cấu hình | Báo không hợp lệ/không tìm thấy; không tự mở website lạ |
| C03 | Consumer C0 đăng ký qua Firebase test number đúng config hoặc số của chính bạn | OTP hợp lệ mới tạo phiên; không dùng OTP giả; nếu chưa có APK Firebase đúng package thì BLOCKED |
| C04 | Đăng xuất rồi reload/đóng mở app | Vẫn ở khách/đăng nhập; refresh cũ không khôi phục phiên |
| C05 | Quên mật khẩu, xác minh rồi đặt mật khẩu mới | Yêu cầu đăng nhập lại; mật khẩu cũ thất bại, mật khẩu mới thành công; không lẫn phiên nhân viên |
| C06 | Đổi consumer A → B rồi đổi trang sản phẩm; kiểm tương tự với hai phiên staff và vụ/chuyến | Không chớp dữ liệu riêng của A hoặc kết quả request cũ; ảnh/draft không đi theo tài khoản mới |
| C07 | Nhấn gửi OTP nhiều lần/quay lại bước trước | Có cooldown, không tự gửi SMS; too-many-requests thì dừng theo hướng dẫn, không đổi IP để né |

Bài consumer không phải điều kiện để test vụ/C3. Không gửi SMS trả phí hàng loạt.
Trong môi trường mô phỏng, trạng thái proof chờ/không có xác nhận thật là giới hạn
môi trường; không đánh PASS cho nghiệm thu Fabric, cũng không mặc định là lỗi UI.

## 4. Sổ số lượng mong đợi của nhánh chính

| Mốc | Đầu ra phải đối chiếu |
|---|---|
| Sau M06 | L1 = 20 kg; tổng thu vụ = 20 kg |
| Sau M07 | L1 = 20 kg, L2 = 30 kg; tổng thu = 50 kg; còn tối đa 50 kg theo kế hoạch |
| Sau G01 | L1 tổng 20 kg, giữ chỗ 12 kg, A chưa giữ chỗ 8 kg |
| Sau G04 | A giữ 8 kg L1, D giữ 12 kg L1; tổng L1 20 kg; G1 DELIVERED |
| Sau G06 | L2 vẫn 30 kg, không còn 5 kg giữ chỗ của G2 |
| Sau P04 | Nguồn NL-P 10 kg đã dùng cho mẻ, đầu ra 8 kg + hao hụt 2 kg; đúng 1 thành phẩm |

Đối chiếu holding theo tổ chức/cơ sở, lượng reserved/unreserved và tổng toàn cục
riêng nhau. Không lấy tổng globalAvailable làm số hàng riêng của một doanh nghiệp.
Mọi số trên giả định không có bán, hỏng, chuyển thêm hoặc tác vụ khác trên cùng lô.

## 5. Cách ghi lỗi và tiêu chí dừng

Dùng [mẫu kết quả JSON](./manual-web-mobile-results.json): mặc định NOT_RUN,
không chứa password/token. Ghi ID thực tế sau khi tạo, ảnh màn hình che thông tin
đăng nhập, bước tái hiện, expected/actual và log có request ID nếu có.

- Crash, âm tồn, lộ dữ liệu khác tổ chức, ký thay bên khác, nhân đôi lô/nhật ký:
  dừng luồng liên quan, giữ ID/body/key gốc để đối soát; không bấm tạo lại liên tục.
- Kết quả gửi chưa rõ: mở hàng đợi/đối soát; reload không là bằng chứng rollback.
- Thiếu SMTP/binding/APK hoặc migration sai: BLOCKED kèm nguyên nhân, không PASS.
- Không xóa audit/lô/chữ ký để dọn test. Lượt sau dùng hậu tố mới.

Thứ tự test lần đầu: **cổng chuẩn bị → W04/W05 → M01–M09 → G01–G06 →
P01–P04 → C01/C04**, sau đó mới test lỗi/quyền/OTP và các nhánh phụ.
