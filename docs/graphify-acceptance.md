# Nghiệm thu tích hợp Graphify

Ngày kiểm tra: 2026-10-04. Phạm vi: công cụ phân tích local và graph tạo từ working
tree hiện tại, bao gồm phần refactor đã staged trước khi cài.

## Kết quả

- Graphify 0.9.75, CPython 3.13.11 Windows x64; 31 dependency khóa phiên bản/hash.
- Corpus: 193 file code/schema và 5 Markdown được chọn; semantic: 70 nút,
  115 quan hệ có nguồn và confidence.
- Graph có hướng: **1.285 nút, 3.597 cặp quan hệ**; JSON giữ **3.790 quan hệ**
  gồm cả nhiều loại/vị trí nguồn cùng một cặp nút.
- Trạng thái cuối: `fresh`, `semantic_fresh=true`.
- Cập nhật lặp không đổi tập nút hoặc nội dung quan hệ và dùng complete AST cache.
  Lần đo cuối: khoảng 34,1 giây dựng graph, 42,6 giây toàn lệnh gọi; thời gian
  thực tế phụ thuộc máy và tải hiện tại. Semantic extraction không chạy lại.
- 307 đường dẫn trong baseline và nội dung Git index có trước khi cài được giữ
  nguyên. Chỉ bổ sung block ignore trong hai file có trước; không stage/commit.

## Kiểm tra tích hợp

| Tiêu chí | Kết quả và bằng chứng |
| --- | --- |
| Phạm vi source | Đối chiếu đường dẫn mọi nút có source với corpus được phép; đủ API/Web/chaincode/gateway |
| Loại trừ dữ liệu | Fixture chứa `.env.secret.ts`, generated, node_modules, wallet, identity, key, `.next` và tài liệu ngoài allowlist đều bị loại |
| Windows | Fixture có dấu tiếng Việt và khoảng trắng chạy được |
| File thay đổi/xóa | Cache phản ánh symbol mới, xóa symbol cũ và file gateway đã xóa |
| Graph cũ | Thay source hoặc sửa graph JSON làm query trả code 2 trước traversal |
| Semantic provenance | Kiểm tra hash tài liệu, bằng chứng liên kết, prompt và fragment; từ chối endpoint không tồn tại |
| ORM resolution | Loại quan hệ bị gán từ Prisma delegate sang service; kiểm tra call `this.create()` thực vẫn được giữ |
| CLI | Năm query nghiệp vụ, explain và path đều trả code 0 và có dữ liệu |
| Liên kết tài liệu/source | Markdown citations được nối với các AST file có thật |
| HTML | Chrome headless hiển thị graph và community ở 1440×1000 qua HTTP local và mở file trực tiếp; thư viện local khớp SHA-384 |
| Skill | Validator của skill-creator báo `Skill is valid!`; dùng `.agents/skills` theo phạm vi repo |
| Tính ổn định | Cập nhật lặp giữ nguyên nút/quan hệ và xác nhận complete AST cache hit |
| Bảo toàn thay đổi cũ | Đối chiếu hash baseline và byte hash Git index đều đạt |

Kết nối browser của Codex bị ngắt trong lượt này; phần hiển thị được kiểm tra
bằng Chrome headless có profile tạm riêng. Không sử dụng profile/tài khoản browser
của người dùng. Server xem trước chỉ phục vụ graphify-out tại localhost và đã
được dừng sau kiểm tra; graph.html có thể mở trực tiếp cùng thư mục vendor.

## Năm luồng đã đối chiếu

| Luồng | Bằng chứng source/graph đã kiểm tra | Ranh giới cần đọc source |
| --- | --- | --- |
| Auth/refresh | AuthController → AuthService; Web auth API và shared HTTP client; nguồn kiểm tra session/role | HTTP Web → API; JWT/session lấy trạng thái hiện tại từ DB |
| Harvest/lot/outbox | LotsService → RecordHarvestService → TraceService; Serializable transaction và các bản ghi cùng transaction | Business commit có thể xảy ra trước Fabric confirmation |
| Worker/Fabric | processPending → submit; worker port/provider, gateway adapter và RecordTraceEvent có trong graph | DI useExisting, outbox lease và transaction-name dispatch |
| Shipment | Controller.receive → service.receive → TraceService; quyền, tổ chức, trạng thái và Decimal quantity từ source | ORM transaction và constraint không được chứng minh bằng edge |
| QR/public | getPublic → presentPublicLot; proofStatus/aggregateProofStatus, lọc sự kiện lot/cycle và projection công khai | HTTP public route, mock mode và aggregate proof status |

HTTP, queue/outbox, DI binding và Fabric dispatch không tự trở thành call trực
tiếp giữa các process. Những phần mô tả nghiệp vụ đã được đối chiếu source khi
viết `graphify-context.md`; helper nghiệm thu kiểm tra khả năng tìm source,
các call pair được hỗ trợ và tính hợp lệ của graph, không chứng minh runtime.

## Giới hạn đã ghi nhận

1. AST thông báo 34 file không có symbol được mô hình hóa, chủ yếu test/callback.
   File/import vẫn có thể xuất hiện; không hiểu là toàn bộ code trong file đã
   được phân tích đầy đủ. `failed_sources` của lần trích xuất là rỗng.
2. Đã loại 9 quan hệ ORM gán nhầm rõ ràng. Các đích gọi còn lại vẫn cần đối
   chiếu source; `EXTRACTED` không bảo đảm target resolution chính xác.
3. Chẩn đoán raw extraction còn 92 edge có endpoint chưa được khai báo bởi
   extractor và 261 external-reference edge. Graphify có thể tạo reference
   stub; JSON cuối không có endpoint thất lạc. Không coi stub là symbol đã
   xác minh. Raw self-loop/duplicate và các cặp nhiều quan hệ còn được ghi
   trong health diagnostic; HTML/traversal dùng graph đơn giản, JSON giữ
   chi tiết quan hệ và vị trí nguồn.
4. SQL snapshot chỉ chứa DDL Prisma hỗ trợ. Invariant, trigger/check constraint
   bổ sung cần đọc migration thật. Không áp migration, không kết nối DB/Fabric.
5. Không chạy bộ test ứng dụng hoặc xác nhận giao dịch Fabric live trong nhiệm
   vụ này. Không có thay đổi logic nghiệp vụ, dependency ứng dụng hay deploy.
6. DOCX/đặc tả Batch lịch sử chưa nằm trong corpus hiện tại. Giữ riêng việc
   đối chiếu tài liệu lịch sử với implementation.

## Bằng chứng local và kiểm tra lại

- `.tools/graphify/acceptance.json`: kết quả fixture, CLI, graph và baseline.
- `.tools/graphify/repeatability.json`: cập nhật lặp và cache.
- `.tools/graphify/semantic-sources.json`: nguồn/fragment hash và thông tin producer.
- `.tools/graphify/ast.json`, `rejected-ast-edges.json`: AST gốc và từng quan hệ loại.
- `.tools/graphify/graph-preview.png`, `graph-file-preview.png`: ảnh hiển thị.
- `graphify-out/.project-state.json`: hash đầu vào và health diagnostic.
- `tools/graphify/provenance.json`: phiên bản, hash wheel và license/reference.

Các bằng chứng/graph/môi trường là dữ liệu local, được Git và Docker bỏ qua.
Sau khi source thay đổi, cập nhật graph trước khi chạy lại:

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py update
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/verify.py
```

Baseline là ảnh chụp tại thời điểm cài. Nếu bạn chủ động sửa những file có trước
sau đó, phần đối chiếu baseline sẽ báo đổi; giữ các thay đổi của bạn và cập nhật
mốc kiểm tra sau khi review. Hướng dẫn sử dụng và gỡ: [graphify-usage.md](graphify-usage.md).
