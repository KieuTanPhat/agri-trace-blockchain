# Kế hoạch: phương thức vận chuyển trong giao nhận, ảnh vụ và tài nguyên farm

Ngày 2026-10-25, nhánh `fix/web-ux-feedback`. Các quyết định dưới đây do chủ dự án
chốt trong phiên làm việc; đây là căn cứ khi sửa, chưa phải hành vi đã triển khai.

## Hiện trạng (đối chiếu source tại `fcba118` + nhánh)

- Phiếu giao nhận luôn có ba bên: gửi, vận chuyển, nhận. `carrierId` bắt buộc và phải là
  doanh nghiệp AgriTrace có năng lực `TRANSPORTER`, thành viên đang hoạt động của chuỗi
  và đã liên kết đối tác với bên gửi (`DistributionService.parties`). Ký lấy hàng: gửi +
  vận chuyển; ký giao: vận chuyển + nhận; quan sát cảm biến và trả hàng do vận chuyển.
- Bên nhận phải đã là thành viên chuỗi của phiếu; phiếu bắt buộc chọn `chainId`.
- Vụ sản xuất bắt buộc thuộc một chuỗi (`production_cycle.chain_id`), nên mọi lô thu
  hoạch đã mang sẵn chuỗi.
- Tab "Phương tiện" trong "Cơ sở & phương tiện" chỉ xét quyền `vehicles.read`, không xét
  năng lực `TRANSPORTER`, nên farm (chủ quản có mọi quyền) vẫn thấy.
- Form nhật ký chăm sóc và thu hoạch chỉ cho tích chọn ảnh đã tải sẵn ở khối
  "Ảnh & chứng từ" (danh sách tên file), không tải và xem ảnh ngay trong form.

## Quyết định

1. **Bốn cách vận chuyển**, luôn hai bên ký tại điểm hàng đổi người giữ:
   - `PLATFORM_CARRIER`: đơn vị vận chuyển trên AgriTrace — giữ luồng hiện tại.
   - `EXTERNAL_CARRIER`: đơn vị ngoài AgriTrace; người lập nhập tên đơn vị, biển số,
     tài xế, ảnh chứng từ. Bên thuê xe là **bên gửi hoặc bên nhận** (chọn khi lập phiếu)
     và là người giữ hàng trên hệ thống trong lúc vận chuyển. Bên gửi thuê: hàng thuộc
     bên gửi tới khi gửi + nhận ký giao. Bên nhận thuê: gửi + nhận ký lúc xe lấy hàng,
     quyền giữ chuyển sang bên nhận ngay.
   - `SELF_DELIVERY`: bên gửi tự chở; giữ hàng tới nơi, gửi + nhận ký khi giao.
   - `RECEIVER_PICKUP`: bên nhận tự lấy; gửi + nhận ký tại điểm lấy hàng. Cả hai bên đều
     lập được phiếu: bên nhận gửi yêu cầu lấy hàng, bên gửi duyệt và chọn lô/số lượng.
2. Ba cách không có đơn vị vận chuyển trên AgriTrace **không ghi quan sát cảm biến** trên
   đường; hàng bị từ chối khi giao ở lại với bên đang giữ hàng (theo điểm 1).
3. **Điều kiện giao nhận**: hai bên chỉ cần đã liên kết đối tác. Phiếu tự đi theo chuỗi
   của lô (không cho chọn chuỗi). Vụ sản xuất vẫn bắt buộc thuộc chuỗi như hiện tại.
   Cập nhật 2026-10-26: mỗi chữ ký cần quyền ledger của người ký trong chuỗi, nên bên
   nhận không thể tự vào chuỗi lúc ký. Chủ dự án chọn "tự mời, chủ chuỗi duyệt": lập
   phiếu thì bên nhận/đơn vị vận chuyển nhận lời mời vào chuỗi; chủ quản bên đó chấp
   nhận trên phiếu; nếu bên giao là chủ chuỗi thì người chấp nhận được cấp vai trò theo
   năng lực, nếu không thì chủ chuỗi cấp vai trò; ký được sau khi quyền ledger đồng bộ.
4. **Phương tiện**: chỉ doanh nghiệp có năng lực `TRANSPORTER` có menu/tab Phương tiện.
   Doanh nghiệp khác thấy menu "Cơ sở"; khi tự chở hoặc tự lấy hàng thì nhập biển số,
   tài xế trực tiếp vào phiếu.
5. **Tồn kho** của farm giữ nguyên, chỉ bổ sung mô tả cho dễ hiểu.
6. **Ảnh nhật ký và thu hoạch**: tải/chụp ảnh ngay trong form, xem trước ảnh thật, vẫn
   cho chọn thêm ảnh đã tải; giữ tối thiểu 1 ảnh.

## Ảnh hưởng kỹ thuật cần xử lý

- Migration mới (không sửa migration cũ): `transport_mode`, `carrier_id` cho phép null
  khi không phải `PLATFORM_CARRIER`, bên thuê xe, thông tin đơn vị/xe/tài xế ngoài; ràng
  buộc CHECK theo từng chế độ. Phiếu cũ mặc định `PLATFORM_CARRIER`.
- Bước ký c2 (`DISTRIBUTION_ATTEST`) và chuyển quyền giữ hàng theo từng chế độ; giữ khóa
  ký một tổ chức mỗi bước, idempotency và optimistic version trong cùng transaction.
- Tự thêm bên nhận vào chuỗi khi chấp nhận phiếu: cần vai trò chuỗi phù hợp, audit chuỗi
  và binding ledger hiện hành; không cấp quyền ghi nghiệp vụ ngoài phiếu đó.
- Cập nhật OpenAPI, kiểu Web, business rules và Hybrid runbook nếu bước ký đổi.

## Nghiệm thu

- Mỗi chế độ: lập phiếu, ký đủ hai bên đúng điểm bàn giao, tồn kho và quyền giữ hàng
  đúng bên ở từng bước, từ chối/trả hàng đúng bên giữ; phiếu cũ vẫn chạy như trước.
- Doanh nghiệp liên kết nhưng chưa cùng chuỗi giao được; bên nhận vào chuỗi sau khi chấp
  nhận và trang truy xuất của lô hiện đủ hành trình.
- Farm không thấy Phương tiện; doanh nghiệp vận chuyển vẫn quản lý xe như cũ.
- Nhật ký/thu hoạch tạo được với ảnh tải ngay trong form; thiếu ảnh bị chặn có thông báo.
- Test DB chạy trên DB cách ly đã migrate; e2e Web cho luồng mới. Chưa có nghiệm thu
  Fabric thật cho bước ký mới.
