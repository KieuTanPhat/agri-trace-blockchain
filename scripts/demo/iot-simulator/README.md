# Thiết bị ảo AgriTrace (ADR-006)

Chương trình đóng vai thiết bị IoT thật để demo không cần phần cứng. Mỗi thiết bị
ảo tự giữ khóa Ed25519, đánh số từng bản ghi (`sequence`), lưu tạm khi mất sóng rồi
gửi bù, và gửi đúng API mà thiết bị thật dùng (`/api/iot/v2/ingest/*`). Thiết bị
hỏi AgriTrace bằng chữ ký riêng để biết đang gắn thửa/xe nào và chuyến hiện tại;
máy chủ tự quyết định bản ghi thuộc về đâu.

Dữ liệu từ đây luôn là **mô phỏng**: khi đăng ký trong AgriTrace phải chọn
"Thiết bị ảo" để mọi màn hình, kể cả trang QR, hiện nhãn mô phỏng.

## Chạy

```bash
npm run demo:iot
```

Mặc định API là `http://localhost:8080/api`, bảng điều khiển ở
`http://127.0.0.1:8097` (chỉ nghe localhost). Đổi bằng `AGRITRACE_API_URL`,
`IOT_SIM_PORT`, `IOT_SIM_STATE_DIR`. Trạng thái và khóa thử nghiệm lưu ở
`.iot-simulator/` (đã nằm trong `.gitignore`); không dùng khóa này cho thiết bị thật.

## Kịch bản

1. Bảng điều khiển → Tạo thiết bị (GPS trên xe hoặc cảm biến vùng trồng).
2. AgriTrace → Thiết bị IoT → Đăng ký thiết bị: dán mã thiết bị và khóa công khai,
   gắn vào thửa (cần `production.write`) hoặc xe (cần `vehicles.manage`).
3. Cảm biến: bấm "Nạp lịch sử" để có dữ liệu cả vụ, rồi để thiết bị đo trực tiếp.
   Máy chủ bỏ phần trước lúc trồng và chỉ ghi vào vụ đang trồng/đang lớn trên thửa.
4. GPS: lập phiếu giao nhận chọn xe đó rồi ký lấy hàng. Thiết bị tự nhận điểm
   đi/đến từ phiếu (hỏi mỗi 15 giây), lấy tuyến OSRM và chạy; không cần bấm xuất
   phát. Cơ sở thiếu tọa độ dùng điểm đại diện tỉnh/thành trong catalog của repo.
   Không có mạng OSRM thì chạy tuyến ước lượng có nhãn. Xe đang chở không đổi GPS.
5. Tạo sự cố để xem hệ thống phản ứng: mất sóng/có sóng lại (gửi bù), dừng bất
   thường (> 30 phút), rút nguồn (chạy pin), GPS bị giả mạo (điểm bất thường),
   gửi lại gói cũ (trùng), giả chữ ký (bị từ chối), tạo khóa mới (cần đổi khóa
   trong AgriTrace).
6. Ký nhận hàng: hành trình được niêm phong vào sự kiện `DISTRIBUTION_DELIVERED`;
   thiết bị tự kết thúc chuyến. Điểm gửi sau đó được đánh dấu muộn và không đổi băm.

Mục **Nâng cao** giữ chạy tuyến thủ công, nạp lịch sử và quản lý khóa. Nhận lại
mã thiết bị cũ tạo khóa mới; dùng "Đổi khóa" trên AgriTrace để ghép lại. Giữ thư
mục trạng thái để không mất khóa, số thứ tự và dữ liệu chưa gửi.

Tuyến mẫu (`routes/`) lấy từ OSRM trên dữ liệu OpenStreetMap: Đà Lạt → chợ đầu
mối Thủ Đức (281 km, qua đèo Bảo Lộc: chậm và mất sóng, có trạm dừng 40 phút) và
Bình Điền → Quận 1 (18 km, nội thành). Chạy theo thời gian thực, không tua giờ.

Kiểm tra mô hình: `npm run test:iot-sim`.
