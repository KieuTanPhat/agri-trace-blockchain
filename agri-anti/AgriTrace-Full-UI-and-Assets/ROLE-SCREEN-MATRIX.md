# Role Screen Matrix

| Role | Dashboard và màn hình chính | Hành động chính |
| --- | --- | --- |
| FARMER | Tổng quan, lô canh tác, nhật ký, thu hoạch, bằng chứng | Tạo lô, cập nhật nhật ký, ghi nhận thu hoạch |
| FARM_MANAGER | Vùng trồng, nông dân, lô sản xuất, xác nhận dữ liệu, sản lượng | Thêm vùng trồng, xác nhận dữ liệu, bàn giao sản phẩm |
| COOPERATIVE | Tiếp nhận, sơ chế, đóng gói, kho, QR, xuất kho | Chấp nhận lô, tạo thành phẩm, tạo QR, xuất kho |
| TRANSPORTER | Chờ tiếp nhận, đang vận chuyển, đã giao, sự cố, IoT | Nhận lô, bắt đầu chuyến, ghi sự cố, xác nhận giao |
| RETAILER | Hàng chờ nhận, kho, đang bán, cách ly, thu hồi | Quét QR, nhận lô, đưa lên kệ, cách ly |
| ADMIN | Tài khoản, phân quyền, danh mục, blockchain, nhật ký, phiên đăng nhập | Gán role, khóa tài khoản, thu hồi phiên, thu hồi lô |
| CONSUMER | Trang truy xuất công khai | Quét QR, xem thông tin và trạng thái thu hồi |

## Route đề xuất

```text
/
/login
/register
/process
/technology
/scan
/trace/[code]
/dashboard/farmer
/dashboard/farm
/dashboard/cooperative
/dashboard/transporter
/dashboard/retailer
/dashboard/admin
/dev/components
/dev/iot-simulator
```

