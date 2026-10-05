# Graphify trong agri-trace-blockchain

Graphify là công cụ hỗ trợ đọc kiến trúc và tìm quan hệ trong repository.
Bản đang dùng: `graphifyy[sql]==0.9.75`, môi trường Python riêng tại
`.tools/graphify/venv`, dependency khóa phiên bản và SHA-256 trong
`tools/graphify/requirements-windows-py313.lock`. Lock này dành cho Windows x64,
CPython 3.13; máy dùng nền tảng khác cần tạo và duyệt lock phù hợp.

## Sử dụng ngay

Chạy tại thư mục gốc. Các lệnh Python bên dưới hoạt động cả khi chính sách
PowerShell trên máy không cho chạy file `.ps1`:

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py status
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py query 'RecordHarvestService TraceService outbox' --budget 1800
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py query 'AuthService refresh token' --budget 1800
```

Khi PowerShell cho phép script, có thể dùng lệnh ngắn tương đương:

```powershell
./tools/graphify/graphify.ps1 status
./tools/graphify/graphify.ps1 query 'LotQueryService proofStatus' --budget 1800
```

Trong Codex, dùng `$graphify` hoặc yêu cầu kiểm tra kiến trúc/luồng nghiệp vụ.
Skill nằm trong `.agents/skills/graphify`, được Codex nạp theo phạm vi repo;
AGENTS.md quy định kiểm tra độ mới của graph và đối chiếu source.
Vị trí skill theo [tài liệu OpenAI](https://learn.chatgpt.com/docs/build-skills).

Mở `graphify-out/graph.html` để tìm kiếm, lọc community và xem thông tin nút.
Thư viện hiển thị đã được lưu cục bộ và kiểm tra SHA-384; mở graph không cần CDN.
Giữ thư mục `vendor` cùng HTML. Dữ liệu đầy đủ nằm trong `graph.json`, còn
`GRAPH_REPORT.md` mô tả các community và giới hạn. Đây là dữ liệu nội bộ chứa
đường dẫn/tên symbol; việc tạo graph chưa bao gồm chia sẻ hay xuất bản nó.

## Phạm vi dữ liệu

- Source API, Web, Fabric chaincode/gateway; test source và script mạng được chọn.
- 5 Markdown: README gốc, kiến trúc Web, ADR modular monolith/worker, tài liệu
  refactor và `docs/graphify-context.md`.
- SQL hiện tại được sinh từ Prisma bằng `migrate diff --from-empty --to-schema`.

`.graphifyignore` và `.gitignore` lọc dữ liệu; wrapper kiểm tra lại đường dẫn
theo allowlist. Không đưa `.env`, khóa/chứng chỉ/identity Fabric, node_modules,
generated Prisma, build, coverage, ảnh, log và DOCX lịch sử vào graph này.
Danh sách thực tế có thể xem bằng lệnh `sources`.
Tài liệu DOCX trong `docs` vẫn có thể được đối chiếu riêng với dự án nếu cần;
chưa được coi là mô tả đúng hiện trạng chỉ vì nằm trong thư mục docs.

## Cập nhật sau khi sửa dự án

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py update
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py status
```

Lệnh `update` dựng lại từ toàn bộ corpus, dùng cache AST cho source không đổi.
File bị xóa sẽ được loại bỏ; không chỉ cộng dồn graph cũ. Lệnh `query`, `path`
và `explain` từ chối graph cũ/đã bị sửa, trả exit code 2 và danh sách đầu vào đổi.
`status` có `semantic_fresh=false` nghĩa là lớp mã nguồn mới nhưng tài liệu còn
chờ trích xuất; không dùng graph đó để kết luận tài liệu đã được cập nhật.

Khi Markdown hoặc nguồn bằng chứng được dẫn trong tài liệu thay đổi, nhờ Codex:
“Dùng $graphify cập nhật cả source và các tài liệu đã chọn; đối chiếu lại
graphify-context với những nguồn đã đổi.” Skill hướng dẫn agent trích xuất,
ghi provenance rồi dựng graph. Wrapper không tự gọi Gemini/OpenAI API hay đọc
API key trong môi trường. Bước semantic sử dụng phiên Codex và có tiêu hao
usage của phiên; công cụ không cung cấp số token chính xác, không báo chi phí
bằng 0 từ các giá trị placeholder.

Nếu chỉ cần code:

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py update --code-only
```

Không có hook, watcher hoặc tác vụ cập nhật ngầm. Không đưa Graphify vào
package.json, dependency ứng dụng, Compose hay pipeline deploy.

## Cài lại trên máy Windows

Máy cần CPython 3.13 x64 và dependency Node/Prisma của repo để sinh SQL. Không
cần PostgreSQL hay Fabric đang chạy. Khi PowerShell cho phép script:

```powershell
./tools/graphify/setup.ps1 -Python 'C:/path/to/Python313/python.exe'
```

Nếu script bị chính sách máy chặn, dùng Python trực tiếp; không đổi policy toàn máy:

```powershell
& 'C:/path/to/Python313/python.exe' -m venv .tools/graphify/venv
& .tools/graphify/venv/Scripts/python.exe -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: -r tools/graphify/requirements-windows-py313.lock
& .tools/graphify/venv/Scripts/python.exe -m pip check
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py version
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py assets
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/project.py update --code-only
```

`assets` tải đúng vis-network 9.1.6 trong lần cài và xác minh integrity trước khi
lưu. Các lần dựng/query dùng bản cục bộ. Không tự nâng phiên bản Graphify.
Config Prisma riêng không nạp dotenv và chỉ có URL giả tới cổng 1 localhost để
schema engine Prisma 7 chấp nhận chạy. Diff chỉ dùng datamodel, không kết nối
database. **Không chạy SQL snapshot như migration**; trigger, check constraint
và các invariant bổ sung phải đọc từ migration thật qua graphify-context.

## Độ tin cậy và kiểm tra

Graph dùng để tìm source liên quan, cần đọc source trước khi kết luận nghiệp vụ.
AST có thể thiếu hoặc gán nhầm đích gọi, đặc biệt ORM, callback và dependency
injection. Wrapper loại các đích service bị gán rõ ràng từ Prisma delegate;
raw AST và từng quan hệ loại bỏ còn trong `.tools/graphify/` để kiểm tra.
`EXTRACTED` là thông tin nguồn trích xuất, không phải cam kết target chính xác.
`path` có thể đi qua import/reference/containment, không chứng minh chuỗi gọi.

JSON giữ nhiều quan hệ cùng cặp nút; HTML và traversal dùng một quan hệ cho mỗi
cặp có hướng. HTTP, outbox và Fabric dispatch không phải call trực tiếp giữa
các process. Mock Web không chứng minh API thật. Graph không chứng minh tính
đúng concurrent transaction, trigger tại database đang chạy hay giao dịch Fabric.

Kiểm tra tích hợp chỉ áp dụng cho công cụ/graph, không thay thế bộ test ứng dụng:

```powershell
& .tools/graphify/venv/Scripts/python.exe -X utf8 tools/graphify/verify.py
```

Kết quả và bằng chứng ở `.tools/graphify/acceptance.json` và
`docs/graphify-acceptance.md`. Phạm vi kiểm tra gồm loại trừ dữ liệu nhạy cảm,
thay đổi/xóa file, graph stale, năm luồng nghiệp vụ, hiển thị HTML và giữ nguyên
source/index có trước khi cài.

## Gỡ tích hợp

Các file mới chỉ thuộc tích hợp này: `.graphifyignore`, `tools/graphify/`,
`.agents/skills/graphify/`, `docs/graphify-context.md`, `docs/graphify-usage.md`,
`docs/graphify-acceptance.md` và `AGENTS.md` mới tạo. Kiểm tra diff trước khi xóa,
giữ lại thay đổi phát sinh sau này của bạn. Nếu cần giữ hướng dẫn CodeGraph,
chỉ xóa block `GRAPHIFY_START` tới `GRAPHIFY_END` trong AGENTS.md.
Danh sách file mới và hash tại bàn giao được lưu trong
`.tools/graphify/owned-files.json`; đối chiếu trước khi gỡ để phát hiện sửa đổi
của bạn sau thời điểm cài.

Trong `.gitignore`, xóa đúng block “Graphify local environment, graph and
acceptance evidence”; trong `.dockerignore`, xóa đúng block “Development-only
Graphify files”. Không reset/revert toàn bộ hai file vì chúng có nội dung khác.
Sau đó xóa riêng `.tools/graphify/` và `graphify-out/` nếu không cần graph/bằng
chứng; đây là dữ liệu local có thể tạo lại. Không dùng `git clean -fdx` hoặc
`git reset` để gỡ. Không có cấu hình toàn máy hay package ứng dụng cần hoàn tác.

## Nguồn và phiên bản

[Repository Graphify](https://github.com/Graphify-Labs/graphify) và
[gói PyPI 0.9.75](https://pypi.org/project/graphifyy/0.9.75/).
Wheel được cài có SHA-256:
`7067b7e19aa9b0758ba1103734e72349d9b4a00a9db1f6174f6b9f16f498a72c`.
Các tài liệu tham chiếu skill giữ license/notice upstream. Wrapper và hướng dẫn
dự án điều chỉnh quy trình cho Windows, source allowlist và độ mới của graph.
