# ADR-004 — Binding Fabric theo chuỗi (B) và chữ ký độc lập (C)

Ngày 13/10/2026, bổ sung phạm vi cài mới 14/10. Source B/C kế tiếp ADR-002
(phạm vi chuỗi) và ADR-003 (route lịch sử). Bằng chứng nghiệm thu ở
[hybrid-acceptance-2026-10-14.md](https://github.com/KieuTanPhat/agri-trace-blockchain/blob/4d92f02122cbb0b4342372474f466c9146522365/docs/hybrid-acceptance-2026-10-14.md); vận hành ở
[hybrid-fabric-runbook.md](hybrid-fabric-runbook.md). Mạng pilot là 3 Org cách
ly trên một máy: quyền của doanh nghiệp đối tác thật vẫn là **NotEvaluated**.

## Bối cảnh

Bản A đã gắn dữ liệu vào chuỗi nhưng mọi chuỗi cùng ghi lên một ledger bằng một
relayer kỹ thuật. Doanh nghiệp chủ chuỗi cần (B) một ledger/channel riêng mà họ
có thể kiểm soát quyền ghi, và (C) bằng chứng rằng chính tổ chức giao/nhận đã
đồng ý một lần chuyển quyền giữ hàng, không chỉ là AgriTrace đã ghi nhận.

## Quyết định cho B

1. **Binding bất biến theo chuỗi.** Một binding là (network, channel, chaincode,
   contract, chain, writer authority/MSP, digest governance). Endpoint, thư mục
   khóa và chứng thư nằm ngoài digest và ngoài DB (`FABRIC_BINDINGS_CONFIG`), nên
   chuyển host hay xoay chứng thư không tách ledger. Cấu hình chỉ chứa chi tiết
   kết nối, không thể chuyển hướng sang ledger khác.
2. **Registry trên ledger là authority.** Channel strict chỉ nhận ghi qua
   `RecordBindingEvent`; chaincode đọc binding, credential (vân tay chứng thư),
   quyền (epoch), fence từ registry và để chúng vào read set (MVCC). Thay đổi
   registry đi qua đề xuất → duyệt → thực thi, với nhóm MSP duyệt nằm trong
   descriptor đóng gói cùng chaincode (không đổi được từ HTTP/DB/env).
3. **Cam kết công khai.** `dataHash = SHA256(miền || JCS(thân công khai))` với thân
   công khai gồm tuple sự kiện, digest thân riêng tư, binding, chain và các quyền đã
   chụp. Relayer không thể thay ngữ cảnh quanh một hash hợp lệ; dữ liệu nghiệp vụ
   không lên ledger.
4. **Quyền ghi đồng bộ với ledger.** Quyền DB chỉ mở ghi sau khi ledger xác nhận
   (trigger chặn). Thu hồi thường có barrier và drain; khẩn cấp giữ ngay. Mỗi epoch
   dùng hai revision registry, ordinal được cấp dưới khóa dòng quyền.
5. **Giao hàng có kiểm soát kết quả không rõ.** Mỗi lần gửi ghi attempt (txId) trước
   khi có traffic mạng; kết quả không rõ được đối soát bằng proof/qscc hoặc bị
   fence, không bao giờ gửi mù. Mỗi binding có circuit breaker riêng; Worker chỉ
   nhận việc điều khiển của binding mình có identity.
6. **Cô lập theo channel.** Mỗi nhóm cộng tác một channel; lịch sử legacy không
   được join. Org tự quản có CA, peer và thư mục khóa riêng, không vào API/Worker.

## Quyết định cho C

1. **Khóa tổ chức Ed25519, đăng ký có bằng chứng sở hữu.** Khóa riêng nằm ở bên ký
   (WebCrypto không trích xuất, dịch vụ ký ngoài hoặc HSM); DB/API chỉ giữ khóa
   công khai. Kích hoạt trên ledger cần admin của cả writer MSP và owner MSP.
2. **Chữ ký không thể bị di chuyển.** Giao thức `agritrace-intent/2` ký lặp lại danh tính công khai của
   sự kiện (intentDigest, chain, event, entity, type, binding, key, payloadDigest), nên chữ ký
   không dùng được cho sự kiện, thực thể, chuỗi, binding hay khóa khác. Chaincode
   kiểm chữ ký rồi mới nhận commitment mà có chữ ký bên trong; intent chỉ dùng một lần.
3. **Ràng buộc nội dung và tránh vòng lặp chữ ký.** Bản sửa c2 tách `payloadDigest`
   của toàn bộ nội dung nghiệp vụ, `metadataDigest` của ngữ cảnh thực thi và
   `assertionDigest` của chữ ký. `privateBodyDigest` là SHA-256 miền
   `agritrace:private-body:c2` trên JCS ba digest đó. Chaincode tính lại digest này,
   kiểm chữ ký có cùng payloadDigest rồi mới nhận dataHash. API/Worker và trigger
   SQL yêu cầu dữ liệu nghiệp vụ thực tế bằng đúng payload của intent, không chỉ
   kiểm bản sao payload trong assertion. Chỉ `actorSignature`, `chainId` và
   `scopeVersion` là trường nền tảng; hai trường ngữ cảnh sau được bao trong
   metadataDigest. Thời gian thực thi, predecessor và vân tay đăng nhập được ledger
   neo tính toàn vẹn nhưng không phải lời xác nhận độc lập của tổ chức. Dữ liệu
   nghiệp vụ vẫn không công khai trên ledger.
4. **Bên ký không tin máy chủ.** Mọi giá trị của intent/payload là chuỗi để
   canonical hóa độc lập; bên ký tính lại payload/intent/thông điệp từ nội dung
   được hiển thị trước khi ký (Web và `org-signer`).
5. **Bàn giao hai bên là cửa duy nhất để đổi quyền giữ hàng ở chuyến `DUAL_SIGNED`.**
   Offer do bên giao ký, confirm do bên nhận ký đúng offer đó (số lượng, phiên bản
   shipment/lot). Chuyển trạng thái chạy cùng giao dịch với xác nhận. Từ chối, hủy,
   hết hạn không đổi quyền giữ hàng. Trigger DB chặn mọi đường cập nhật trực tiếp.
6. **Chế độ ghim theo luồng.** Chuyến lấy chế độ của chuỗi lúc tạo và không đổi; chuỗi
   chỉ đổi chế độ khi không có đề nghị mở và có khóa hoạt động. Không bật C giữa một
   bàn giao đang thực hiện.
7. **Không dùng đồng hồ làm bằng chứng.** Chaincode không có Date.now() cho quyết
   định; `eventTime` của actor không chứng minh chữ ký có trước khi thu hồi. Sự kiện đã
   ký nhưng tới ledger sau khi khóa bị thu hồi bị từ chối và thành dead letter cần
   rà soát; hệ thống không báo xác minh cho nó.
8. **Hết hạn do API kiểm.** DB không so sánh timestamp ứng dụng với `now()` vì
   driver ghi timestamp không kèm offset; chỉ so các giá trị cùng nguồn.

## Hệ quả

- Hệ thống giữ A (envelope 3.0.0, hash 2.0.0), B (4.0.0 / 3.0.0), C c1 lịch sử
  (5.0.0 / 4.0.0) và ghi mới C c2 (6.0.0 / 5.0.0). Bộ đọc/kiểm tra phân nhánh theo phiên bản
  và **fail closed** với phiên bản lạ; bằng chứng legacy 64-hex vẫn đúng, chữ ký thật
  không bao giờ đi qua trường vân tay.
- c1 từng cho phép relayer thay thân riêng tư rồi tính lại commitment quanh chữ ký
  hợp lệ. c2 chặn đường này; chaincode và DB từ chối ghi c1 mới. Bộ đọc lịch sử c1
  kiểm thêm nội dung thực tế khớp payload đã ký, giữ nguyên hash; bằng chứng không
  khớp phải được rà soát. Intent c1 chưa thực hiện cần chuẩn bị lại; command đã
  gửi/kết quả chưa rõ phải đối soát proof/attempt bằng khóa cũ trước, không đổi
  event/hash hoặc tự cấp khóa idempotency mới. Worker đối soát c1 đã commit;
  trường hợp chưa commit sau đối soát dừng ở dead letter để operator xử lý.
- Migration của A/B/C tạo kiểu, hàm và trigger nên cổng CD tự động chặn và cần quy
  trình review checksum trong root config. Bản cài mới thêm migration cleanup
  append-only, giữ byte A/B/C, từ chối history hiện có; không import history cũ.
  Merge/deploy đã được chủ dự án giao sau các checks; smoke trên VPS là cổng cuối,
  không có giai đoạn canary/quan sát liên tục riêng.
- Pilot chưa chứng minh: doanh nghiệp thật giữ khóa/peer ở host khác, availability
  khi mất orderer, ủy quyền ký qua AgriTrace, timestamp authority độc lập, chữ ký
  cho sự kiện ngoài bàn giao. Các mục này là **Deferred/NotEvaluated**, không ghi
  Passed.

## Phương án đã loại

- *Đổi trực tiếp `start`/`arrive` sang cần chữ ký*: giữ A/B nguyên vẹn cho chuỗi cũ và
  tránh một bước chuyển đổi giữa chừng; chế độ ghim theo chuyến rõ ràng hơn.
- *Chaincode tự kiểm payload nghiệp vụ*: sẽ đưa dữ liệu riêng tư lên ledger; commitment
  công khai + digest thân riêng tư đạt cùng mục tiêu mà không lộ dữ liệu.
- *Khóa tổ chức thật do AgriTrace sinh và giữ*: không là xác nhận độc lập. Khóa
  kỹ thuật của smoke được giữ riêng trong operator, chỉ chứng minh giao thức và
  không nâng external partner authority khỏi NotEvaluated.
