# Phiếu nhập nguyên liệu, tồn kho chế biến và vòng đời lệnh chế biến (27/10/2026)

Nhánh: `feature/processing-receipts-lifecycle` (tách từ main `26317c1`; bản đầu viết trên nhánh cũ `feature/enterprise-registration-plans` rồi chuyển sang). Trạng thái: đang triển khai; chủ dự án duyệt đưa lên production
sau khi CI xanh và có receipt sao lưu hai host.

## Quyết định đã chốt

| Câu hỏi | Quyết định |
| --- | --- |
| Phiếu nhập từ giao nhận AgriTrace | Tự sinh khi bên nhận xác nhận thực nhận; tồn tăng ngay như hiện nay (cách A) |
| Nguyên liệu ngoài nền tảng | Phiếu nhập ngoài: nhà cung cấp, số chứng từ, bắt buộc ảnh hóa đơn/giấy kiểm nghiệm; QR thành phẩm ghi "nguồn ngoài – doanh nghiệp tự khai" |
| Số sản phẩm mỗi lệnh | 1 sản phẩm chính chọn khi lập lệnh; ra lò có thể thêm phụ phẩm |
| Vòng đời | Kế hoạch → Bắt đầu (giữ chỗ nguyên liệu, được bổ sung) → nhật ký → Ra lò 1 lần |
| Nhật ký | Bước, thời gian, người làm, ghi chú, ảnh không bắt buộc; hiện trên QR công khai, ẩn tên nhân viên; chỉ ghi thêm, không sửa/xóa |
| Tồn kho | Chỉ số lượng, không giá trị tiền |

## Thiết kế

### Dữ liệu (migration `20261221000000_processing_receipts_lifecycle`)

- `material_receipt` — phiếu nhập nguyên liệu tại cơ sở chế biến/đóng gói.
  - `source = AGRITRACE`: gắn `transfer_id` + `lot_id`, lượng = thực nhận, tạo trong
    transaction xác nhận nhận hàng; tồn vẫn là `lot_site_holding` của lô (không đếm hai lần).
  - `source = EXTERNAL`: `material_name`, `supplier_name`, `document_no`, ngày nhập,
    lượng/đơn vị, hạn dùng; tồn theo `quantity/reserved/consumed` của chính phiếu.
    Chỉ dùng được khi đã có ít nhất một ảnh chứng từ (`trace_evidence`
    `entity_type = MATERIAL_RECEIPT`). Phiếu không sửa/xóa.
- `processing_run`:
  - thêm `product_id` (sản phẩm chính), `binding_digest`, `started_at`, `started_by`;
  - trạng thái `DRAFT` (kế hoạch) → `IN_PROGRESS` → `COMPLETED`; hủy được từ
    `DRAFT`/`IN_PROGRESS` (trả lại phần giữ chỗ).
  - Hoàn tất không còn bắt buộc `origin_cycle_id` (lệnh chỉ dùng nguyên liệu ngoài).
- `processing_external_input` — dòng nguyên liệu ngoài của lệnh (phiếu nhập + lượng).
- `processing_log` — nhật ký: bước, thời điểm, ghi chú, người ghi, `corrects_id`;
  chỉ thêm khi lệnh `IN_PROGRESS`.
- Trigger: chuyển trạng thái hợp lệ, dòng nguyên liệu thêm khi `DRAFT`/`IN_PROGRESS`,
  thành phẩm/hao hụt thêm và lô thành phẩm tạo khi `IN_PROGRESS`; cân bằng khối
  lượng cộng cả nguyên liệu ngoài.

### Giữ chỗ và trừ kho

- Bắt đầu: tăng `reserved` ở `lot_holding`/`lot_site_holding` của lô AgriTrace và
  `reserved` của phiếu nhập ngoài. Bổ sung nguyên liệu khi đang chế biến giữ chỗ ngay.
- Ra lò: trừ `quantity` và `reserved` cùng lúc; phiếu ngoài tăng `consumed`, giảm `reserved`.
- Hủy lệnh đang chế biến: giảm `reserved`.

### Sổ cái

- Binding của lệnh: theo vụ gốc của lô AgriTrace (như cũ); lệnh chỉ có nguyên liệu
  ngoài lấy binding đang hoạt động của chuỗi lúc lập (`binding_digest`).
  `TraceService` nhận thêm gốc là lệnh chế biến không có vụ gốc. Chuỗi chưa có
  binding hoạt động thì không lập được lệnh chỉ dùng nguyên liệu ngoài.
- Không ghi sự kiện riêng cho từng dòng nhật ký hay phiếu nhập ngoài. Sự kiện
  `PROCESSING_OUTPUT` lúc ra lò chứa danh sách nguyên liệu ngoài (nhà cung cấp,
  số chứng từ) và các bước nhật ký (bước, thời điểm, băm ghi chú) nên được neo
  lên Fabric cùng lô thành phẩm.

### API (`/processing`)

- `GET /processing/receipts`, `POST /processing/receipts` (nhập ngoài).
- `GET /processing/stock` — tồn nguyên liệu (lô AgriTrace + phiếu ngoài) và thành phẩm theo cơ sở.
- `POST /processing` — lập kế hoạch: sản phẩm chính, cơ sở, chuỗi, nguyên liệu.
- `POST /processing/:id/start`, `POST /processing/:id/inputs` (bổ sung),
  `POST /processing/:id/logs`, `POST /processing/:id/complete` (ra lò: lượng
  sản phẩm chính, phụ phẩm, hao hụt), `POST /processing/:id/cancel`.

### Web

- `/enterprise/processing/receipts` (+ `/new` nhập ngoài, tải ảnh chứng từ).
- `/enterprise/processing/stock` — hai nhóm Nguyên liệu / Thành phẩm.
- `/enterprise/processing/new` — chọn sản phẩm chính + nguyên liệu.
- `/enterprise/processing/[id]` — bắt đầu, bổ sung nguyên liệu, nhật ký, ra lò.
- QR công khai: nguồn ngoài tự khai và các bước chế biến.

## Ngoài phạm vi / để sau

- Bộ test riêng cho phiếu nhập/vòng đời (unit, SQL guard) làm sau; trước merge chạy
  CI đầy đủ.
- Shipment cũ (luồng gắn vụ) không sinh phiếu nhập.
- Giá trị tiền, giá vốn.
