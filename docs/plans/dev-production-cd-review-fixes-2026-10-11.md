# Review và sửa lỗi delivery dev / production — 2026-10-11

Baseline: `88ba8e7a133186b52ed80454a6abe97e63e81a93` trên `main` và `dev`.
Scope: controller, quản trị runtime Fabric, backup transport và runbook của
đợt tách `nongtrace.site` / `agritrace.dev`. Liên quan AGT-031; không thay thế
nghiệm thu nghiệp vụ/Fabric AGT-029/030 hoặc tự mở production CD.

## Các lỗi được xác nhận từ source

| ID | Mức | Điều kiện và hậu quả | Cách sửa / kiểm chứng |
| --- | --- | --- | --- |
| R1 | P1 | Dev đã suspend/retire, nhánh có SHA mới: rollout đọc migrations bằng `exec postgres` trước khi khởi động lại database nên deploy thất bại. Resume cùng SHA hiện có không bao phủ trường hợp này. | Khởi động release dev đã verified từ volume đúng ownership trước baseline của rollout mới; không bootstrap/reset; test stopped/healthy/foreign volume và rehearsal với database thật. |
| R2 | P1 | Đã bật Fabric dev rồi chuyển về light: snapshot chỉ lấy DB/config, bỏ ledger/identities đang được giữ lại dù DB còn proof. | Backup mọi Fabric binding còn tồn tại; khi light phải kiểm container đã dừng và ownership trước đọc volume; không tự bật Fabric; test archive/checksums và từ chối runtime/mount sai. |
| R3 | P1 | Bật/tắt Fabric, API đã start nhưng verification thất bại: cleanup chỉ dừng Worker/Fabric, API tiếp tục nhận ghi trong transition chưa hoàn tất. | Dừng cả API/Worker của đúng project trên mọi lỗi sau marker, kể cả initial stop/interruption; giữ marker và báo cleanup không hoàn tất; test lỗi sau start và lỗi stop đầu tiên. |
| R4 | P2 | Light chưa có Fabric, crash sau promotion với fingerprint chaincode mới: recover trả app cũ nhưng giữ fingerprint mới trong state. | Reconcile fingerprint với source release được phục hồi; nếu có retained ledger thì yêu cầu tương thích; test recovery sau promotion và retained-ledger mismatch. |
| R5 | P2 | File backup cùng SHA đã tồn tại, transport thất bại hoặc mở file exclusive lỗi: catch xóa luôn file đã hoàn tất trước đó. | Tải vào thư mục riêng, xác minh rồi publish file hoàn tất bằng thao tác không overwrite; cleanup chỉ xóa file của lần tải hiện tại; test backup cũ còn nguyên khi retry lỗi. |

## Thứ tự thực hiện

1. Viết regression tests, chạy trên baseline để chứng minh các lỗi.
2. Sửa controller/admin/transport, cập nhật runbook; chạy Python Linux và Node CI tests.
3. Review diff, PR và ba CI bắt buộc trên SHA hiện tại; không bypass protection.
4. Cài helper root từ source đã review, giữ cấu hình và state hiện có.
5. Đồng bộ `dev` với `main`; thử retire dev ở SHA cũ rồi deploy SHA mới, kiểm
   volume/data/event hashes, public homepage/QR và production IDs/health/data.
6. Ghi evidence, trạng thái hoàn tất và các giới hạn nghiệm thu còn lại.

## Giới hạn nghiệm thu

Dev mặc định light. Mạng Fabric dev chưa được provision; các tình huống R2/R3
với Fabric riêng được kiểm bằng fixtures kiểm soát, không được báo là rehearsal
Fabric dev trên VPS. Không tạo mạng blockchain thứ hai trong đợt review này.
Production CD giữ disabled; topology production, tải/p95 và full-host Fabric
restore vẫn cần Mốc B cùng owner/reviewer. Không reset database đang chạy.

## Kết quả

Regression trên baseline: 12 Python scenarios có 9 failures + 1 error (hai
đường healthy/reject candidate đã đúng); transport test tái hiện việc mất
backup cũ. Đây là kiểm thử có chủ đích trước khi sửa, không phải lỗi CI còn mở.

Đã sửa R1–R5 và cập nhật runbook. Linux Python controller/SSH suite đạt;
Linux Node CD/config/verifier có 35 tests đạt, không skip. `npm run test:ci`
trên Windows đạt; năm SSH transport tests bị skip trên Windows đã chạy đạt
riêng trên Linux. Rehearsal CI nay gọi chính hàm resume của controller với
PostgreSQL thật, thay cho compose up thủ công che khuất lỗi R1.

PR/CI bắt buộc và kiểm chứng rollout trên VPS đang được thực hiện. Evidence
rollout mới được ghi bổ sung sau khi hoàn tất, không suy từ unit tests.
