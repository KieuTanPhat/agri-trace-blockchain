# ADR-005 — Tư cách tham gia, chủ chuỗi và đầu vào liên chuỗi

Trạng thái: Accepted, ngày 02/11/2026. Thay phân loại thương mại `SINGLE` /
`SUPPLY_CHAIN_ENTERPRISE` và quy tắc `payingParticipant` (FARM hoặc doanh nghiệp
chuỗi thì trả phí). Source, SQL guards và Swagger xác định implementation; dữ liệu
trước ngày này là mô phỏng nên đợt này cài mới (DB trống, Fabric mới) theo
migration `20261224000000_chain_owner_service_model`.

## Bối cảnh

Thu phí theo vai trò khiến nông trại bị xếp vào bên trả phí, còn nhà chế biến
đứng tên sản phẩm lại không tạo được chuỗi. Các nền tảng truy xuất đang vận hành
(TrusTrace, Sourcemap, Fairfood Trace, IBM Food Trust, V-Standard) thu phí bên
đứng tên sản phẩm và để bên đóng góp dữ liệu tham gia miễn phí. FSMA 204 và GS1
EPCIS chỉ cho khâu đóng gói lần đầu/chuyển đổi tạo mã lô mới; khâu xuất và nhận
giữ mã lô của nguồn.

## Quyết định

1. **Chỉ tổ chức đăng ký.** Loại hình pháp lý chỉ còn `ENTERPRISE` và
   `COOPERATIVE`, đều bắt buộc mã số thuế, số giấy đăng ký và người đại diện.
   Nông hộ, vựa, thương lái nhỏ vào hệ thống qua HTX (nhân viên ghi theo thửa) hoặc
   qua phiếu nhập ngoài của bên mua.
2. **Năng lực và tư cách tách nhau.** Năm năng lực (`FARM`, `PROCESSOR`,
   `TRANSPORTER`, `DISTRIBUTOR`, `RETAILER`) quyết định được làm khâu nào, số lượng
   tùy ý, admin duyệt từng năng lực và có thể xin thêm sau kích hoạt. Tư cách
   `organization.participation_status` chọn bắt buộc lúc đăng ký:
   - `MEMBER`: 0đ. Ghi nghiệp vụ theo năng lực trong chuỗi được mời hoặc nhận lô.
   - `CHAIN_OWNER`: cần ít nhất một năng lực sở hữu hàng (không phải chỉ
     `TRANSPORTER`). Mua gói; `CREATE_CHAIN` được cấp khi subscription chuyển
     `ACTIVE` (thanh toán mô phỏng hoặc admin xác nhận). Thành viên nâng cấp lên chủ
     chuỗi giữ nguyên tài khoản và dữ liệu.
3. **Gói theo quy mô.** Hạn mức `products` (sản phẩm thành phẩm), `chains`,
   `partners` (số tổ chức khác nhau đang `ACTIVE` trong các chuỗi của chủ, không
   tính lời mời đang chờ) và `members` (nhân viên). Bỏ hạn mức tem. Vượt hạn mức thì
   chặn tạo mới, giữ dữ liệu; không hạ gói thấp hơn mức đang dùng. Hóa đơn theo mẫu
   hóa đơn điện tử (Nghị định 123/2020) nhưng đánh dấu mô phỏng.
4. **Sổ ghi nông trại.** Chuỗi `personal = true` đổi nghĩa thành sổ ghi miễn phí
   của tổ chức có năng lực `FARM`, tự tạo khi năng lực này được duyệt. Hạn mức theo
   năm `billing.farmLedgerLimits` (mặc định 10 vụ, 100 lô). Sổ không có quyền của
   chủ chuỗi (trang thương hiệu, mời đối tác, phát động thu hồi) và không tính vào
   hạn mức gói. Chủ chuỗi tạo chuỗi theo dòng sản phẩm bằng bước "Tạo chuỗi đầu
   tiên".
5. **Lô giữ chuỗi gốc.** Bàn giao thuần không chuyển lô; bên nhận vào chuỗi gốc khi
   chấp nhận (đã có). Quyền nghiệp vụ trong chuỗi gốc được cấp khi người gửi là
   thành viên `ACTIVE` của chuỗi đó. Lô chỉ sang chuỗi khác qua **lệnh chế biến hoặc
   đóng gói có đầu vào liên chuỗi**: lệnh ghim binding của chuỗi chủ nhãn
   (`origin_cycle_id` rỗng, như lệnh chỉ dùng nguyên liệu ngoài), sự kiện tiêu thụ
   đầu vào vẫn ghi trên luồng chuỗi gốc, và `processing_cross_chain_input` lưu
   event id, `data_hash`, binding của sự kiện đó làm liên kết kiểm chứng. Bán dưới
   nhãn mới bắt buộc qua lệnh này (cần `PROCESSOR` và giấy an toàn thực phẩm).
6. **Mỗi sản phẩm thành phẩm một chủ.** Sản phẩm gắn vào chuỗi phải thuộc đúng
   tổ chức chủ chuỗi (trigger DB). Trang thương hiệu chỉ hiện khi admin đã duyệt
   sản phẩm (`product.approval_status = APPROVED`); ghi lô không phụ thuộc duyệt.
7. **Quyền chủ chuỗi và đối tác.** Chủ chuỗi không sửa dữ liệu của đối tác; bộ dữ
   liệu bắt buộc mỗi khâu do hệ thống cố định. Đối tác chỉ thấy bước trước/sau liền
   kề; trang quét công khai theo cơ chế công bố hiện có. Chủ chuỗi "loại" đối tác
   thì đặt `chain_membership.closing_at` (ngừng bàn giao mới); chỉ tạm ngừng và thu
   hồi quyền khi đối tác hết hàng và không còn giao nhận mở. Đối tác tự rời theo
   cùng điều kiện. Chủ chuỗi hết hạn: lô đang dở hoàn tất được, chặn tạo vụ/lô/lệnh
   mới.
8. **Thu hồi.** Bên giữ hàng vẫn cách ly ngay (an toàn thực phẩm). Thu hồi công khai
   do chủ chuỗi của lô phát động; đối tác gửi đề xuất. Lô có đầu vào liên chuỗi thì
   báo chủ chuỗi gốc.
9. **Nguyên liệu ngoài và mức tin cậy.** Danh bạ nhà cung cấp thay tên tự do. Chứng
   từ chấp nhận: hóa đơn, bảng kê 01/TNDN, phiếu cân, giấy kiểm nghiệm (bắt buộc ít
   nhất một). Mức tin cậy: `DECLARED` (khai báo) → `EVIDENCED` (có chứng từ) →
   `SUPPLIER_CONFIRMED` (nhà cung cấp quét QR trên chứng từ, không cần tài khoản,
   token dùng một lần) → `SELF_RECORDED` (lô AgriTrace do nhà cung cấp tự ghi). Trang
   quét hiện mức tin cậy và tỉ lệ nguồn chỉ khai báo.
10. **Xuất ra ngoài hệ thống.** Bên giữ hàng ghi `EXTERNAL_DISPATCH` (đơn vị nhận,
    chứng từ) hoặc bán thẳng (`SALE` cho bên có `FARM`/`PROCESSOR`). Tự vận chuyển
    dùng `SELF_DELIVERY` sẵn có.

## Hệ quả

- `payingParticipant`, `audienceFor`, `participation_model` và ba loại hình hộ/cá
  nhân bị gỡ; Swagger, web và mobile sinh lại contract.
- Trigger `fn_hybrid_event_context_scope`, `fn_b_event_context` vẫn từ chối khác
  chuỗi/binding; chỉ đường đầu vào liên chuỗi đã ghim binding chuỗi đích được thêm.
  Không sửa event, hash hay history hiện có.
- Để sau: tem định danh từng bao, chuyển nhượng chủ chuỗi, gói tài trợ, cảm biến
  kho/chuyến, thanh toán và hóa đơn thật, Cổng truy xuất quốc gia.
