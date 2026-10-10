# Kế hoạch sửa có chọn lọc và đánh giá ảnh hưởng

Baseline: `715e9bfb3a9364d83d620a778c97a6d3b5c0180c`, ngày 09/10/2026.
Mục tiêu là xử lý các điểm có lợi ích cụ thể, giữ luồng
`ProductionCycle → HarvestEvent → Lot → Shipment` và kiểm chứng trước merge.

## Quyết định phạm vi

| Điểm đã xác nhận | Trước sửa | Sau sửa và lợi ích | Ảnh hưởng / quyết định |
| --- | --- | --- | --- |
| Gateway khởi tạo thất bại | Client gRPC đã được tạo nhưng không được đóng khi đọc identity/key hoặc tạo Gateway lỗi. | Đóng client khi thất bại, trả lại đúng lỗi gốc cho caller. | Thay đổi vòng đời tài nguyên ở nhánh lỗi; giữ nhánh thành công, deadline và retry policy. Nên sửa. |
| `businessData as never` | Ép kiểu che khuất khả năng truyền giá trị không phù hợp JSON. Chưa thấy lỗi nghiệp vụ trong các caller hiện tại. | Nhận `Prisma.InputJsonObject`, truyền thẳng vào TraceService. | Thay đổi type; không serialize hay normalize payload. Nên sửa nhỏ. |
| Web dùng `LotTrace` cho QR công khai | Type yêu cầu shipment id/version/org/quantity dù API công khai không trả. Trang QR hiện chưa đọc các field đó nên chưa chứng minh crash. | `PublicLotTrace` mô tả projection thực, gồm null/date, actor công khai và certificate allowlist. | Transport và API giữ nguyên. Mock QR dùng projection công khai, không còn trả actor nội bộ/command. Nên sửa. |
| OpenAPI chưa đầy đủ | 58 operation, 31 schema rỗng và chưa có response content schema trong tài liệu sinh từ baseline. | Cần metadata request/response/error/security/envelope và artifact có version. | Hoãn khỏi PR này: thuộc [AGT-010](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/22), cần review contract đầy đủ. |
| Generated client/type và tài liệu đang chỉnh tại checkout chính | Type Web viết tay; tài liệu có thay đổi chưa commit của người dùng. | Typegen theo OpenAPI đã chốt; cập nhật tài liệu theo trạng thái đã xác minh. | Hoãn phần typegen cho [AGT-011](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/23). Không đưa các chỉnh sửa tài liệu chưa commit vào PR này. |

## Thứ tự thực hiện và tiêu chí

1. Tạo nhánh từ `origin/main` trong worktree riêng; lưu baseline và kiểm diff.
2. Sửa Gateway trong phạm vi `connectGateway`. Test lỗi đọc cert/key,
   parse key, signer và connect; client phải đóng đúng một lần và lỗi gốc
   phải được giữ, kể cả khi cleanup lỗi. Test thành công phải giữ client mở
   đến khi caller gọi `close()`.
3. Thay type tham số `businessData`, bỏ cast. So sánh JavaScript transpile
   trước/sau và chạy API typecheck/E2E; không thêm bước đổi payload/hash.
4. Tách type QR công khai theo `toPublicLotDto`, `PUBLIC_LOT_INCLUDE` và
   Prisma schema. Kiểm API client nhận nguyên payload có shipment thiếu
   field nội bộ, date/null/certificate hợp lệ. Kiểm mock công khai không
   chứa actor riêng tư, retailer hoặc command và không làm đổi mock nội bộ.
5. Chạy root `npm run check` với Node/npm hỗ trợ và database test riêng.
   Tự review toàn bộ diff, không chỉ dựa vào test xanh.
6. Push nhánh, tạo PR; merge khi đúng head SHA có ba gate thành công:
   `Application gate`, `Blockchain gate`, `Dependency gate`. Kiểm các job
   production/Fabric phải thực sự chạy theo phạm vi. Nếu có finding chưa
   giải quyết, CI lỗi hoặc yêu cầu review chưa đạt thì giữ PR mở.

## Ràng buộc nghiệp vụ và cách kiểm chứng

- Prisma schema/migration, transaction harvest/trace/outbox, state machine,
  quantity/custody, role/org và idempotency không thay đổi.
- Canonical JSON, hash chain, proof aggregation, Worker lease/retry và
  payload gửi Fabric không thay đổi. Gateway giữ cùng lỗi gốc.
- Query/presenter API công khai và certificate allowlist không thay đổi;
  sửa Web theo payload hiện có, không thêm field vào API để khớp type cũ.
- Shared HTTP refresh, session ownership, header, unwrap và stable
  Idempotency-Key không thay đổi.
- Không sửa dependency/lockfile, CI/CD, không refactor module lớn và không
  bổ sung các command nghiệp vụ chưa được nghiệm thu.

## Bằng chứng và tự đánh giá

Đã chạy trên worktree chứa bản sửa, Windows, Node `24.19.0`, npm `12.1.0`
(cả các script lồng nhau) và PostgreSQL `18` với database test riêng.
`npm run check` và `node --test scripts/ci/worker-contract.test.mjs` đều
exit `0`; PostgreSQL test đã dừng sau kiểm tra.

| Kiểm tra local | Kết quả |
| --- | --- |
| API lint/typecheck/build | Đạt; lint không có warning. |
| API unit / E2E PostgreSQL | 86 / 57 test đạt, E2E không skip. |
| Web lint/typecheck/build | Đạt; lint không có warning. |
| Web unit / lint contract / image optimizer | 100 / 84 / 4 test đạt. |
| Chaincode typecheck/build/coverage | 34 test đạt; statements 93,43%, branches 86,84%. |
| Gateway typecheck/build/runtime load | 14 test đạt, gồm 11 test vòng đời mới. |
| Worker dùng validator chaincode đã compile | 1 test đạt, xác nhận payload được chấp nhận và giữ business data ngoài chain. |
| Logic chọn job/gate CI/CD | 25 test đạt, 3 test SSH chỉ chạy Linux được skip trên Windows. |
| JavaScript transpile ProductionCyclesService trước/sau | Giống hệt, SHA-256 `5c15b4d46b767ee785d782831eaa86cea043e3ff565eeb462b66a93a9aa4ceaf`. |
| Checkout chính trước push | Cả 328 file tracked giữ nguyên hash; trạng thái các chỉnh sửa có sẵn giữ nguyên. |

Tự review diff: chưa phát hiện finding cần chặn merge trong phạm vi sửa.
Gateway chỉ đổi cleanup sau lỗi; lỗi gốc, nhánh thành công và deadline giữ
nguyên. Backend thay type mà không đổi JavaScript. Web production giữ nguyên
request và giao diện; mock QR hiển thị actor ẩn danh như API thật và bỏ các
field nội bộ. Các mock nội bộ không bị biến đổi.

Quyết định: nên giữ ba bản sửa này; chưa có lý do để refactor rộng hoặc thay
quy tắc nghiệp vụ. Type QR vẫn viết tay, nên khả năng drift tương lai còn tồn
tại cho đến khi AGT-010/011 hoàn tất. Các check local chưa thay bằng chứng
Linux/Node matrix, production containers và Fabric thật; các phần đó được
yêu cầu qua CI của PR.

Kết quả CI gắn đúng head SHA, trạng thái merge và kết quả pipeline sau merge
được ghi ở PR chứa tài liệu này. Không dùng CI xanh để tự công nhận nghiệm
thu AGT-010/011 hoặc quyết định actor compliance trong AGT-026.

Merge vào `main` kích hoạt các pipeline CI và UAT CD theo cấu hình hiện có.
Việc merge và kết quả triển khai là hai trạng thái được kiểm tra riêng.
