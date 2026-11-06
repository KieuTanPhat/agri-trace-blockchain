# Kế hoạch seed đầy đủ 227 sản phẩm lên production

Lập ngày 06/11/2026 từ các vòng hỏi với chủ dự án và đối chiếu source trên nhánh
`feature/unified-agritrace-tasks` (`b8a5c5ae`). Trạng thái: **đã chạy thử trên môi trường cách ly, chưa lên production**.
Nguồn dữ liệu: `Downloads/Data (1) (1)`, gồm 331 file, 85 MB. Bảng duyệt và nội dung
nằm ở `.codex/seed-227/` (không vào Git).

## 1. Mục đích và điều kiện

Chủ dự án xác nhận production **chỉ là demo**, không có hàng thật bán ra. Vì vậy dùng
nguyên 20 logo, nguyên ảnh giấy tờ và không gắn nhãn mô phỏng trên giao diện.

Điều kiện đi kèm: site phải có `noindex`; giấy tờ chỉ hiện nội bộ. Nếu production
chuyển sang phục vụ người mua thật, phải gỡ bộ dữ liệu này trước.

## 2. Phạm vi đã chốt

| Hạng mục | Quyết định |
| --- | --- |
| Sản phẩm | 227 (194 thô, 33 chế biến), **tất cả đi đủ chuỗi**; mỗi sản phẩm một ảnh riêng |
| Doanh nghiệp | 20, mỗi doanh nghiệp một logo; 11 nông trại/HTX, 2 chế biến, 2 phân phối, 2 vận chuyển, 2 bán lẻ, 1 kiểm định |
| Hồ sơ | Hư cấu nhưng sát thực tế; cờ `synthetic` trong dữ liệu; không dùng số nhà thật |
| Chuỗi | 13: 11 chuỗi của nông trại, 2 chuỗi của nhà chế biến; nguyên liệu vào qua đầu vào liên chuỗi (ADR-005) |
| Chế độ ký | Các chuỗi dùng `STANDARD`; API từ chối phiếu phân phối mới trên chuỗi `DUAL_SIGNED` |
| Vận chuyển | Trộn 3 kiểu: đa số qua E13 (Nam) và E16 (Bắc), một số tự giao có tài xế, vài chuyến thuê ngoài |
| Sự kiện | Mọi sự kiện đều có ảnh; mỗi doanh nghiệp 1-6 sự kiện trên một lô, số lượng ngẫu nhiên có seed cố định, đúng quy tắc; không bắt buộc đi hết mọi khâu |
| Ảnh dùng chung | Ảnh chăm sóc, nhà kho được trùng; quay vòng theo đúng loại việc |
| Ngày nghiệp vụ | Xuống giống lùi theo cây, tới 12 tháng; thu hoạch gần ngày seed (hàng tươi 1-14 ngày, hàng khô tới 90 ngày) vì giao nhận theo giờ thật và lô quá hạn bị chặn; mô tả không nêu tháng cụ thể; thời điểm neo Fabric là thời gian thật |
| Proof | Mọi event có proof Fabric thật |
| Nội dung sản phẩm | Đã viết đủ 227: Mô tả 80-120 từ, Bảo quản và Sử dụng mỗi ô 30-40 từ, tổng dưới 200 từ; không nêu dinh dưỡng hay công dụng; có Thành phần |
| Giấy tờ | Theo loại hình; dùng nguyên ảnh, chỉ hiện nội bộ; hợp đồng liên kết làm mẫu mới vì `hopdonglienketmuaban.jpg` sai loại |
| Nhãn mô phỏng | Không hiện trên giao diện; chỉ có cờ `synthetic` và nguồn `SIMULATED` trong dữ liệu |
| IoT vùng trồng | 42 sản phẩm tiêu biểu; mô hình `device-models`, 1 giờ/lần, gửi bù trước thu hoạch; niêm phong vào sự kiện thu hoạch |
| IoT vận chuyển | 15 chuyến GPS, chỉ ghi vị trí; xe chạy nền với tốc độ khoảng 70 km/h trong lúc seed các phiếu khác, tối thiểu 12 phút, nên tuyến có thể chưa tới điểm nhận; đường đi là đoạn thẳng giữa hai tỉnh; hash tuyến vào `DISTRIBUTION_DELIVERED` rồi neo Fabric |
| Tài khoản | Chủ và 2 nhân viên mỗi doanh nghiệp, có tài xế và kiểm định viên, admin, vài người tiêu dùng; mật khẩu ở `run/accounts.json` |
| Gói dịch vụ | Chủ chuỗi dùng gói `OWNER_ENTERPRISE` vì gói `OWNER_SCALE` chỉ cho 20 sản phẩm; có hóa đơn gia hạn cho 3 doanh nghiệp; SePay tắt |
| Nội dung khác | Kiểm định và chứng nhận, tin tức, thông báo admin, nhật ký quản trị |

Bước `SALE` không nằm trong lựa chọn nên không ghi nhận bán. Trang công khai vẫn hiện
"Đang bán" khi nhà bán lẻ còn tồn bán được.

### Tình huống trạng thái cho demo

Số lượng dưới đây là đề xuất, chỉnh ở bước lập kịch bản.

| Tình huống | Số lượng |
| --- | --- |
| Phiếu chờ ký đồng ý hoặc lấy hàng | 8 |
| Phiếu đang vận chuyển | 6 |
| Nhận thiếu, từ chối một phần, cách ly | 5 |
| Lệnh chế biến hoặc phiếu bị hủy | 3 |
| Lô thu hồi, hiện cảnh báo trên QR | 3 |

### Tin tức

Yêu cầu là bài dài trên 1.000 từ, dùng ảnh và nội dung thật. **Không sao chép** nguyên
bài hay ảnh từ báo và website khác vì vi phạm bản quyền. Cách làm:

- Tra cứu thông tin công khai, viết lại thành bài mới, ghi nguồn tham khảo cuối bài.
- Ảnh dùng từ bộ `Data`, hoặc ảnh có giấy phép cho phép dùng lại, ghi nguồn trong
  `PHOTO_CREDITS`.
- Đề xuất 8 bài, chủ đề: truy xuất nguồn gốc, mùa vụ, an toàn thực phẩm, chuyển đổi
  số nông nghiệp. Không đưa số liệu chưa có nguồn.

## 3. Luồng dữ liệu một sản phẩm

Hàng thô: khai sản phẩm và ảnh, hoàn tất hồ sơ, tạo vụ, xuống giống, chăm sóc (1-6
sự kiện có ảnh), số đo cảm biến nếu có IoT, thu hoạch tạo lô và QR, phiếu giao
(đồng ý 3 bên, lấy hàng 2 bên, biên nhận, giao hàng 2 bên), tới phân phối hoặc nhà
chế biến, tới bán lẻ.

Hàng chế biến: nhận nguyên liệu qua phiếu giao, phiếu nhập, lệnh chế biến trong chuỗi
của nhà chế biến với đầu vào liên chuỗi, nhật ký mẻ, ra lô thành phẩm có QR, giao
bán lẻ. Đường mía dùng đầu vào hàng ngoài.

Lần chạy thử sạch tạo 7.049 event, 194 vụ, 245 lô, 33 lệnh chế biến, 373 phiếu giao,
khoảng 2.700 bằng chứng và mất khoảng 61 phút với ledger mô phỏng. Trên Fabric thật,
Worker gửi 20 event mỗi 10 giây nên riêng phần neo tối thiểu khoảng 59 phút.

Phiếu tình huống dùng lượng nhỏ riêng nên không làm gãy chuỗi chính: cả 227 sản phẩm
vẫn tới bán lẻ. Phiếu đang chạy giữ xe nên phải tạo sau cùng, vì mỗi xe chỉ chạy một
phiếu một lúc.

## 3a. Điều kiện trước khi seed production

- `ENTERPRISE_PAYMENTS_ENABLED=true` và `PLATFORM_SECRET_KEY` phải có trong private env,
  nếu không bước hóa đơn và hộp thư quyền riêng tư bị từ chối. Lỗi đã trả về được giữ theo
  Idempotency-Key, nên bật cấu hình rồi `--resume` vẫn nhận lại lỗi cũ.
- 21/22 migration mới có SQL ngoài nhóm thuần bổ sung, phải thêm vào `migration_reviews`
  của config CD. Checksum ở `.codex/seed-227/migration-reviews.json`, tính lại sau khi merge.
- Commit trước khi đóng gói: `production-dataset-bundle.mjs` đọc script từ `HEAD`.
- Chạy thử dùng ledger mô phỏng trên DB cách ly, không phải Fabric 3 Org local, vì
  `local-fabric-operator` chỉ chạy trên stack chính và sẽ xóa dữ liệu local. Phần bind 13
  chuỗi, xác nhận quyền ledger và proof thật chưa được chạy thử với bộ dữ liệu này.

## 4. Các bước

### Giai đoạn 1: chốt dữ liệu (local)

1. Chủ dự án duyệt bảng và 13 mục Cần xem lại.
2. Lập bảng gán 84 file còn lại: 39 ảnh chăm sóc, 36 ảnh nhà kho, 9 giấy tờ.
3. Lập kịch bản: thửa, kho, xe, lô, số lượng, tuyến giao, mốc ngày theo cây, 15
   chuyến GPS, 42 sản phẩm IoT, các tình huống mục 2.
4. Viết 8 bài tin, hợp đồng liên kết mẫu.
5. Chuẩn hóa ảnh, chuyển `avif/webp`, sinh manifest SHA-256. `.codex/fruit-assets`
   không có trong checkout này.

### Giai đoạn 2: sửa code

6. Đưa catalog vào `scripts/demo`, viết lại `full-seed.mjs` theo catalog thay vì 5
   doanh nghiệp cố định. Phần bootstrap tổ chức và gói hiện ghi trực tiếp qua Prisma,
   giữ nguyên cách này; dữ liệu nghiệp vụ đi qua API.
7. Viết mới: đầu vào liên chuỗi, tự giao và thuê ngoài, GPS song song (mỗi xe một
   phiếu), các tình huống trạng thái.
8. Sửa lỗi đã biết: `full-seed.mjs:26` thiếu import `seedTarget`, đưa các sửa của
   PR #129 vào nhánh. Mở rộng `verify-seed.mjs`.
9. Sửa `production-dataset-bundle.mjs` đóng gói catalog, ảnh, giấy tờ.
10. Web và API: hiện Mô tả trên trang sản phẩm công khai, bỏ nhãn IoT trên giao diện
    và cập nhật ADR-006, thêm `noindex`, cập nhật runbook.

### Giai đoạn 3: chạy thử local

11. Chạy toàn bộ trên DB cách ly và Fabric 3 Org local. Docker đang tắt, cần bật.
12. Đo thời gian, sửa lỗi, chạy lại đến khi `verify-seed` đạt. Đây chưa phải nghiệm
    thu production.

### Giai đoạn 4: release

13. PR từ `feature/unified-agritrace-tasks` vào `main`; CI xanh gồm Fabric thật.
14. Rà migration không thuần bổ sung (gồm `20270101000008`), pin vào config CD.
15. Đặt `CD_DEPLOY_ENABLED=false`, merge, chạy CD `publish`.

### Giai đoạn 5: cài lại production (không hoàn tác được)

16. Tạo danh sách xóa. **Dừng, chủ dự án duyệt.** Không sao lưu theo quyết định.
17. Chạy `apply`, `provision`, `initialize`; bật lại `CD_DEPLOY_ENABLED=true`, chạy
    `reinstall`. Script cài lại đợt 27/10 ở scratchpad phiên cũ, phải kiểm còn dùng
    được. Kiểm dung lượng đĩa VPS trước khi chạy.

### Giai đoạn 6: seed và nghiệm thu

18. Đóng gói đúng SHA, chép lên VPS, chạy
    `python3 -I scripts/demo/production-dataset-run.py --bundle <gói>`. Runner dừng mã
    75 ở mỗi chuỗi mới để bind, tổng 13 chuỗi.
19. Lỗi giữa chừng: cài lại từ đầu theo quyết định, quay lại bước 16 và xin duyệt lại.
20. Nghiệm thu theo mục 5. Chủ dự án duyệt kết quả.

## 5. Bằng chứng nghiệm thu

Số liệu tóm tắt ghi vào Issue/PR. File chi tiết để ở artifact local ngoài Git. Không
ghi mật khẩu, token, nội dung `.env`.

| Bằng chứng | Nội dung |
| --- | --- |
| Định danh | SHA release, revision controller, `installation_generation`, Fabric instance |
| Duyệt | Danh sách xóa đã duyệt, thời điểm duyệt, ghi nhận không sao lưu |
| Đầu vào | Hash `bundle.json`, manifest ảnh, bảng đã duyệt |
| Chạy thử | Thời gian, số event, kết quả `verify-seed` trên local |
| Chạy seed | Giờ bắt đầu/kết thúc, log đã lọc, checkpoint, mã thoát |
| Đếm | Doanh nghiệp, chuỗi, sản phẩm, lô, event, media, tài khoản so với kế hoạch |
| Proof | Số proof bằng số outbox, phải 100%; không có outbox treo |
| Trình duyệt | Ảnh chụp trang công khai và danh bạ, mỗi nhóm hàng một mẫu, mỗi tình huống một mẫu |
| App | Quét QR trên ACheck và đăng nhập app nhân viên, mỗi nhóm hàng một mẫu |
| Quyền riêng tư | Giấy tờ không hiện ở API và trang công khai; `noindex` có hiệu lực |

Đạt khi: `verify-seed` đạt, proof 100%, kiểm trình duyệt và app đạt, chủ dự án duyệt.

## 6. Rủi ro đã chấp nhận

- Không sao lưu và lỗi thì cài lại: mỗi lỗi trên production mất một vòng cài lại.
- Cài lại xóa toàn bộ tài khoản, gồm tài khoản đang dùng trên production.
- 3 ảnh giấy (`giaycndkidoanhnghiep01.jpg`, `chungnhandat2.jpg`, `chungnhandat3.jpg`)
  có số định danh và địa chỉ nhà, đưa lên nguyên trạng và chỉ hiện nội bộ.
- Logo thương hiệu thật hiện công khai cùng doanh nghiệp hư cấu; `noindex` chỉ giảm
  mức lan rộng, không ngăn người có đường dẫn xem được.
- Đường liên chuỗi, GPS song song và các tình huống là code seed mới, chưa từng chạy.
