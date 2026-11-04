# ADR-006 — Cảm biến vùng trồng và định vị xe theo phiếu giao nhận

Trạng thái: Accepted, ngày 04/11/2026. Bổ sung ADR-005 (mục "Để sau: cảm biến
kho/chuyến"). Source, SQL guards và Swagger xác định implementation; migration
`20261231000000_iot_plot_vehicle_tracking`.

## Bối cảnh

IoT cũ dùng một khóa chung `IOT_INGEST_API_KEY` cho mọi thiết bị, gắn thiết bị
trực tiếp vào vụ và gắn định vị vào `Shipment` legacy. Luồng giao nhận hiện hành
(`DistributionTransfer`) chỉ có nhật ký tay; web không có màn thiết bị, biểu đồ
hay bản đồ. Quyền IoT dựa trên vai trò cũ, không có trong bộ quyền doanh nghiệp.

Demo không dùng phần cứng hay app điện thoại: thiết bị ảo phải đi đúng đường
của thiết bị thật (danh tính riêng, chữ ký, số thứ tự, mất sóng gửi bù) và luôn
được gắn nhãn mô phỏng.

## Quyết định

1. **Thiết bị gắn vào tài sản.** Hai loại: `FIELD_SENSOR` gắn **thửa** (`plot`),
   `GPS_TRACKER` gắn **xe** (`enterprise_vehicle`). Không có IoT kho. Một thiết bị
   gắn tối đa một tài sản; mỗi xe tối đa một GPS đang hoạt động. Dữ liệu cảm biến
   tự vào mọi vụ `PLANTED`/`GROWING` trên thửa đó (mỗi vụ một bản ghi); không có
   vụ đang chạy thì bỏ bản ghi. Nhật ký vụ và IoT tách riêng.
2. **Danh tính riêng từng thiết bị.** Thiết bị tự giữ khóa Ed25519; doanh nghiệp
   đăng ký mã thiết bị và khóa công khai (như ghép nối). API không nhận khóa riêng.
   Mỗi gói ký trên RFC 8785 của thân request; mỗi bản ghi có `sequence` tăng dần,
   duy nhất theo thiết bị (gửi lại là trùng, không ghi). `sentAt` lệch quá 5 phút
   bị từ chối. Đổi khóa và thu hồi tăng `authority_revision`. Đường cũ dùng khóa
   chung giữ cho `Shipment` legacy và CI hiện có, không dùng cho luồng mới.
3. **Quyền.** Thêm `devices.read`, `devices.manage` (manage kéo theo read). Gắn
   thửa cần thêm `production.write`; gắn xe cần thêm `vehicles.manage`; thửa/xe
   phải thuộc chính doanh nghiệp. Thành viên `MEMBER` dùng miễn phí. Admin, Auditor
   và chủ chuỗi không đăng ký hay sửa thiết bị của doanh nghiệp khác.
4. **Định vị thuộc bên chở.** Chỉ ghi vị trí; vận chuyển không ghi nhiệt độ (cột
   `distribution_observation.temperature` bị xóa, sự kiện cũ giữ nguyên byte).
   Vị trí của GPS trên xe được ghi vào phiếu đang `IN_TRANSIT` dùng xe đó, trong
   khoảng `[in_transit_at, delivered_at]`. Bên chở là `carrierId`: đơn vị vận chuyển
   (`PLATFORM_CARRIER`), bên giao (`SELF_DELIVERY`) hoặc bên nhận
   (`RECEIVER_PICKUP`); hai mode sau nay được chọn xe đã khai của chính mình.
   `EXTERNAL_CARRIER` không có định vị tự động. Nhật ký tay mở cho mọi bên chở trên
   AgriTrace (không gồm thuê ngoài).
5. **Mỗi xe một phiếu.** Partial unique index chặn hai phiếu `IN_TRANSIT` cùng xe
   khi lấy hàng từ nay (có `in_transit_at`); dữ liệu mô phỏng cũ giữ nguyên. Lỗi
   được báo khi ký lấy hàng.
6. **Không bắt buộc, có mức tin cậy.** IoT không chặn thu hoạch hay giao nhận.
   Hành trình có độ phủ (tỉ lệ thời gian có điểm, khoảng mất tín hiệu > 10 phút)
   và nguồn: `DEVICE`, `SIMULATED`, `NONE`. Thiết bị `simulated = true` luôn hiện
   "Dữ liệu mô phỏng", kể cả trên QR.
7. **Bất thường xác định tại ingest.** Điểm có tốc độ suy ra > 180 km/h so với
   điểm hợp lệ trước là `ANOMALY` (`JUMP`), sai số > 100 m là `ANOMALY`
   (`LOW_ACCURACY`); không vào quãng đường. Dừng lâu (> 30 phút ngoài 300 m quanh
   điểm nhận), mất tín hiệu và "đã đến gần điểm nhận" được tính khi đọc. Lệch
   tuyến chưa làm vì phiếu không có tuyến dự kiến.
8. **Niêm phong hành trình.** Khi đủ chữ ký `DELIVERY`, cùng transaction tạo
   `distribution_route_seal` (băm RFC 8785 của danh sách điểm hợp lệ, số điểm,
   quãng đường, độ phủ, số bất thường) và đưa `routeSeal` vào business data của
   sự kiện `DISTRIBUTION_DELIVERED` sẵn có; không thêm event type, không sửa
   chaincode. Đường `DUAL_SIGNED` (payload c2 đã ký) không thêm niêm phong. Điểm
   đến sau niêm phong được ghi `LATE`, không làm đổi băm. Bảng vị trí append-only.
9. **Tọa độ cơ sở.** `enterprise_site` có `latitude/longitude` tùy chọn để vẽ
   điểm giao/nhận và tính "đã đến". Trang QR chỉ hiện hành trình tổng quát (quãng
   đường, thời gian, độ phủ, nguồn), không hiện điểm dừng hay tọa độ chi tiết.

## Hệ quả

- Web có màn Thiết bị, biểu đồ cảm biến trong vụ, bản đồ hành trình trên phiếu
  (Leaflet + OpenStreetMap) và tóm tắt trên QR. Thiết bị ảo ở
  `scripts/demo/iot-simulator` có bảng điều khiển riêng, ngoài API nghiệp vụ.
- Chủ chuỗi không áp yêu cầu IoT lên đối tác (ADR-005 mục 7).
- Để sau: thiết bị thật (Traccar/ESP32), connector hộp đen giám sát hành trình,
  tuyến dự kiến và cảnh báo lệch tuyến, gỡ đường khóa chung khi Shipment legacy
  được retire.
