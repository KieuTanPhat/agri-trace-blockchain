# ADR-004 — Scope chuỗi, binding Fabric và chữ ký c2

Trạng thái: Accepted. Quyết định B/C ngày 13/10/2026; cập nhật phạm vi hiện hành
ngày 02/11/2026, hợp nhất quyết định scope còn hiệu lực từ ADR-002/003.
Source, SQL guards và Swagger xác định implementation; nghiệm thu đúng SHA theo
[CI guide](ci.md) và [production runbook](production-runbook.md).

## Phiên bản hiện hành

- B: envelope 4.0.0 / private hash 3.0.0.
- C c2: envelope 6.0.0 / private hash 5.0.0, `agritrace-intent/2`.
- A/c1 đã gỡ cả reader và writer. Migration
  `20261213000000_retire_release_a_and_c1` từ chối DB còn A/c1; không sửa hash/history
  hoặc hồi sinh fallback. Môi trường local dùng binding giả lập cùng đường ghi B.

## Scope nghiệp vụ và route

- Cycle là scope gốc của sản xuất; Harvest/Lot/Shipment resolve chain qua quan hệ,
  không nhân bản chainId có thể mâu thuẫn. Farm/Organization dùng chung không là
  ranh giới chain. Processing chỉ dùng nguồn ngoài giữ chain/binding trên run.
- Tạo cycle cần chain profile và binding ACTIVE. Capability không tự cấp grant,
  membership hoặc assignment; server kiểm quyền hiện hành cả trước replay.
- Production assignment thuộc đúng Farm/org; transport assignment trỏ Shipment,
  retail assignment trỏ Lot. Finalize plan tạo assignment/Shipment/trace/outbox
  cùng transaction; không đổi người thực hiện để vượt custody đã chốt.
- ShipmentPlanRevision và consent bất biến theo revision/role. Consent chụp grant,
  membership epoch và capability revision; rejoin/regrant không hồi sinh consent.
  Nháp không giữ lượng; đường Shipment dùng toàn bộ availableQuantity. Finalize
  khóa quyền, chain, plan và Lot; chỉ một Shipment cho mỗi Lot, không đổi org/route/lượng
  sau CREATED. Đường distribution tách riêng, giữ Lot nguồn và quantity history.
- Event chụp route/binding bất biến cùng trace/outbox. Worker kiểm pin/authority
  trước claim; proof/QR đọc đích đã pin, không fallback network/channel từ env.
  Xoay endpoint/cert không được chuyển backlog sang ledger khác.
- Production mới không backfill lịch sử test hoặc nâng trust của proof cũ. Các
  migration scope/binding lịch sử giữ nguyên byte; cleanup append-only từ chối
  history/exemption trái điều kiện. Controlled import cũ không còn là quy trình
  cài mới; nguyên bản ADR-002/003 có trong Git trước cleanup.

## Bối cảnh

Thiết kế ban đầu gắn dữ liệu vào chuỗi nhưng dùng chung relayer kỹ thuật.
AgriTrace vận hành mạng dùng chung cho mọi doanh nghiệp. Chủ chuỗi cần (B) binding và scope riêng trên cùng channel, và (C) bằng chứng rằng chính tổ chức giao/nhận đã
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
6. **Nền tảng dùng chung.** Channel `agritrace` chỉ có application MSP `AgritraceMSP`; orderer thuộc `OrdererMSP`. Doanh nghiệp không chọn mạng/channel/MSP hoặc vận hành peer. Cô lập doanh nghiệp bằng authorization và projection trong ứng dụng; mọi peer nền tảng có cùng public ledger metadata. Mỗi chuỗi giữ chainRef/binding/permission riêng.
7. **Chuẩn bị tự động.** Tạo chuỗi enqueue công việc trong cùng transaction. Worker dùng target operator đã pin, đăng ký registry/credential rồi mới kích hoạt binding và đồng bộ quyền. Retry giữ target/proposal gốc.

## Quyết định cho C

1. **Khóa tổ chức Ed25519, đăng ký có bằng chứng sở hữu.** Khóa riêng nằm ở bên ký
   (WebCrypto không trích xuất, dịch vụ ký ngoài hoặc HSM); DB/API chỉ giữ khóa
   công khai. Kích hoạt trên ledger cần registry admin của `AgritraceMSP` cùng proof-of-possession của doanh nghiệp; Worker tự đồng bộ public key. Quyền admin nền tảng không thay thế chữ ký nghiệp vụ của doanh nghiệp.
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

### Actor evidence và dữ liệu trả về (AGT-009)

`actorAuthProof` là SHA-256 của user ID và role do server tạo sau xác thực;
nhãn lịch sử `TOKEN_FINGERPRINT` không có nghĩa là băm JWT, chữ ký user hay
bằng chứng của một phiên đăng nhập cụ thể. Giữ nguyên nhãn và byte của lịch sử.
Chữ ký tổ chức Ed25519 của C nằm trong sidecar riêng, theo giao thức ở trên.

History của Lot yêu cầu quyền và scope chuỗi hiện hành, chỉ trả tuple sự kiện,
thời gian, phiên bản, hash/predecessor, receipt công khai và trạng thái/retry.
Không trả actor ID/fingerprint, business payload, signing intent/signature,
lease/token hoặc lỗi nội bộ của Worker. Hai endpoint proof/verify chỉ trả
thông báo lỗi giao hàng chung cùng event ID; diagnostic gốc giữ trong DB để
operator đối soát. OpenAPI sinh từ DTO là contract của projection này.

Fabric B/c2 chỉ nhận envelope đã kiểm: tuple, phiên bản, digest, binding/quyền
và assertion công khai khi C yêu cầu; raw payload, sensor reading, giá, PII,
token và khóa riêng giữ off-chain. Kiểm transaction arguments tại Gateway và
chaincode, không chỉ dữ liệu query trả về. Phiên bản không hỗ trợ hoặc actor/
payload khác commitment phải báo integrity warning, không sửa hash để khớp.

Review AGT-009 trước Hybrid được tra trong Git; phạm vi hiện hành theo ADR này,
PROJECT_CONTEXT và runbook.
Unit/contract test không thay nghiệm thu Fabric thật của đúng candidate SHA.

### Tương thích và phạm vi nghiệm thu

- B/c2 fail closed với phiên bản lạ. API/SQL/Worker kiểm nội dung thật khớp payload
  đã ký; không dùng nhãn vân tay actor làm chữ ký. Command unknown giữ body/key
  gốc để đối soát trước mọi quyết định gửi lại.
- Historical migration giữ byte; SQL có kiểu/hàm/trigger phải review checksum
  theo controller. Cleanup không nhập history cũ và không tự sửa DB có dữ liệu.
- Nghiệm thu real Fabric, CI, restore và VPS smoke theo runbook, tách khỏi source
  completion. Thông tin deploy trong một phiên cũ không cấp quyền cho lần mới.
- Pilot chưa chứng minh CA/peer/admin/signer của đối tác thật trên host khác, HA,
  timestamp authority hoặc chữ ký ngoài bàn giao: giữ Deferred/NotEvaluated.
- Distribution mới trên DUAL_SIGNED cần integration/acceptance c2 riêng; không
  dùng bằng chứng Shipment đã ký để mở giao thức này.

## Phương án đã loại

- *Đổi trực tiếp `start`/`arrive` sang cần chữ ký*: chế độ bàn giao phải ghim theo
  chuyến, không thay giao thức khi một chuyến đang thực hiện.
- *Chaincode tự kiểm payload nghiệp vụ*: sẽ đưa dữ liệu riêng tư lên ledger; commitment
  công khai + digest thân riêng tư đạt cùng mục tiêu mà không lộ dữ liệu.
- *Khóa tổ chức thật do AgriTrace sinh và giữ*: không là xác nhận độc lập. Khóa
  kỹ thuật của smoke được giữ riêng trong operator, chỉ chứng minh giao thức và
  không chứng minh quyền ký nghiệp vụ nếu doanh nghiệp không tự giữ khóa.
