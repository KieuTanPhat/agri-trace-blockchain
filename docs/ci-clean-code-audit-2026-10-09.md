# Kiểm tra CI/CD và chất lượng mã — 09/10/2026

## Phạm vi và phiên bản

Kiểm tra checkout local `93fb5dedceea332982c2c02e238df824d567ce9a` cùng các
thay đổi CI/lint/test trong báo cáo này. Worktree đã có thay đổi tài liệu
trước khi kiểm tra; các thay đổi đó được giữ nguyên. Bản sửa chưa commit,
push hoặc deployment tại thời điểm kiểm tra ban đầu, nên bằng chứng local
trong bảng dưới đây không phải kết quả CI của một commit mới.

GitHub `main` tại thời điểm kiểm tra là
`204b284fe72e394bd4a5de18ec2a104b145e2ee0`, đi trước checkout 7 commit.
Các commit mới có thay đổi nghiệp vụ/phân quyền; không suy ra kết quả test
local cho phiên bản mới đó. Đối chiếu acceptance/ownership ở
[AGT-003](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/15),
[AGT-002](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/14) và
[AGT-031](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/43).

## Kết quả GitHub đã xác minh

| Bằng chứng | Kết quả và ý nghĩa |
| --- | --- |
| [Application CI của checkout](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37664935155) | SUCCESS; API/Web/container bị skip do commit tài liệu. Không chứng minh các job đó chạy trên SHA này. |
| [Blockchain CI của checkout](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37664935206) | SUCCESS; verify/standalone/Fabric bị skip. |
| [Dependency Audit của checkout](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37664935258) | SUCCESS. |
| [Application CI của main mới](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37885489715) | SUCCESS; API/Web/container cũng bị skip trên commit tài liệu này. |
| [Blockchain CI của main mới](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37885489684), [Dependency Audit](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37885489774) | Cả hai workflow SUCCESS; không gán bằng chứng này cho bản sửa local. |
| [UAT CD gần nhất](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37882501886) | SUCCESS trên SHA `1d903d04b044424b656307aeb1a5a218f9b78ef5`; gate, publish và deliver/verify đều SUCCESS. |
| [Ruleset Protect main](https://github.com/KieuTanPhat/agri-trace-blockchain/rules/23749640) | Active, strict status checks; bắt buộc Application gate, Blockchain gate, Dependency gate từ GitHub Actions. Quyền bypass sẵn có của repository role không thay đổi. |

## Vấn đề và phương án đã thực hiện

| Ưu tiên | Vấn đề đã xác nhận | Thay đổi |
| --- | --- | --- |
| P1 | Push chọn job theo diff; commit tài liệu sau commit code chưa đạt có thể có gate xanh trong khi CD chỉ yêu cầu workflow push thành công của SHA. | `scripts/ci/changes.mjs` chạy toàn bộ cho mọi push main, merge queue và dispatch. PR tiếp tục chọn job theo đường dẫn. Thêm test hồi quy cho push có baseline hợp lệ/không có diff. |
| P2 | Test logic CI chỉ chạy trong API matrix: PR không chọn API bỏ qua test, còn PR chọn API chạy lặp ba lần. | Chuyển test vào job `changes` luôn chạy của Application CI. `test:ci` local gồm cả CD gate/SSH transport; root `check` chạy suite này trước workspace checks. |
| P2 | Lint có rule ở mức warning nhưng warning không làm lệnh thất bại. | API/Web lint dùng `--max-warnings 0`, giữ nguyên rule/severity. Thêm hai build canary chứng minh warning của ESLint và Oxlint Next chặn compiler, cùng các canary error đã có. |
| P2 | E2E PostgreSQL dùng `describe.skip` khi thiếu `TEST_DATABASE_URL`; root check có thể xanh với test DB bị bỏ qua. | E2E config nạp dotenv và từ chối khởi động khi thiếu/rỗng biến này. Kiểm cả trường hợp thiếu biến và trường hợp database test thực. |
| Môi trường | Node 24.14.1/npm 11.11.0 mặc định thấp hơn yêu cầu repo; npm cũ báo invalid đối với các override đã cài đúng. | Dùng Node 24.19.0 đã có và npm 12.1.0 cài trong thư mục công cụ riêng. Audit/peer graph bằng runtime này đều đạt; không thay framework/dependency/lockfile của ứng dụng. |

Phương án giữ thay đổi trong CI, script kiểm tra và tài liệu. Không đổi
API contract, nghiệp vụ, Prisma schema/migration, chính sách hash/proof hay
ngưỡng coverage/audit. Chi phí tăng ở push main để có bằng chứng đầy đủ cho
SHA deployable; PR vẫn tối ưu bằng chọn job. Không thay đổi ruleset hoặc
cấu hình VPS trong đợt này.

## Kiểm chứng local

Môi trường: Windows x64, Node 24.19.0, npm 12.1.0, PostgreSQL 18. Cluster
mới chỉ nghe `127.0.0.1:55439`, database `agri_trace_quality_test`, dữ liệu
thử riêng. Tám migration được áp dụng lên database này; không kết nối DB
nghiệp vụ. PostgreSQL test được dừng trong `finally` sau checks.

| Kiểm tra | Kết quả |
| --- | --- |
| E2E khi thiếu TEST_DATABASE_URL | PASS: lệnh thất bại với thông báo cấu hình trước khi chạy suite. |
| CI selection/gates và CD gate | 25 PASS; 3 test SSH transport skip đúng thiết kế trên Windows, cần Linux CI. |
| CD policy/controller Python | 12 PASS; 7 test durable directory fsync skip đúng thiết kế trên Windows, cần Linux CI. |
| API unit | 63 PASS. |
| API E2E PostgreSQL | 54 PASS, 0 skip. |
| Web unit | 27 PASS. |
| Chaincode unit/coverage độc lập | 34 PASS; statements 93.15%, branches 86.84%, functions 100%, lines 94.73%; vượt gate 90/85. |
| Gateway unit | 3 PASS. |
| API/Web lint | PASS, 0 warning/error. |
| Typecheck bốn workspace | PASS. |
| Audit workspace full/production và peer graph | PASS, 0 advisory, 0 invalid peer. |
| Cài/audit/check chaincode theo lockfile độc lập | PASS, 0 advisory full/production, peer graph hợp lệ; build/runtime load đạt. |
| YAML của bốn workflow và git diff --check phần sửa | PASS. |
| Root npm run check | PASS, exit 0; API, Web, chaincode và Gateway check/build đều đạt. PostgreSQL test đã dừng. |
| Web lint contract | 84 PASS, 0 skip; cả warning/error của hai lint engine chặn build trước compiler. |
| Web image optimizer | 4 PASS, PNG/JPEG/WebP/AVIF. |
| Chaincode coverage trong workspace | 34 PASS; statements 93.43%, branches 86.84%, functions 100%, lines 94.94%. |
| Prettier trên config E2E đã sửa | PASS. |

Audit evidence mới được lưu riêng ở
`.uat/ci-quality/dependency-evidence/{workspace,chaincode}/`: metadata,
SHA checkout, `worktreeDirty: true`, Node/npm, checksum manifest/lockfile và
JSON audit/peer graph. Thư mục này được gitignore vì là bằng chứng local;
không ghi token, private key hoặc payload nghiệp vụ vào báo cáo.

Lỗi EPERM/ENOTFOUND khi chạy trong sandbox được kiểm tra lại ngoài sandbox
sau khi cấp quyền. Chỉ kết quả chạy lại thành công được tính là bằng chứng
chất lượng. Docker Desktop engine hiện chưa chạy, nên chưa có smoke
container/Fabric mới cho bản sửa local. Test DB trên PostgreSQL 18 không
thay bằng chứng PostgreSQL 16 hoặc matrix Node 22/24/26 trên CI.

## Kế hoạch tích hợp an toàn

Ngày 09/10, người dùng đã yêu cầu merge các sửa CI/clean code và báo cáo này.
Bản sửa được áp dụng bằng patch lên nhánh riêng từ main
`204b284fe72e394bd4a5de18ec2a104b145e2ee0`; giữ các thay đổi HTTPS và nghiệp vụ
đã merge. Các tài liệu/công cụ local ngoài phạm vi được bảo toàn trong checkout
gốc. Kết quả PR và push main phải đọc từ GitHub Actions của đúng SHA.

1. Áp dụng riêng các file sửa CI/lint/test và tài liệu vào nhánh PR từ main
   mới nhất; giữ các thay đổi tài liệu đang có và các thay đổi nghiệp vụ
   upstream. Không push toàn bộ dirty worktree lên main.
2. Cài theo lockfile với Node/npm đúng yêu cầu; chạy `npm run check` với
   database test riêng đã migrate, audit workspace và chaincode độc lập.
3. Yêu cầu cả ba gate CI trên PR đạt; kiểm API E2E không skip, lint warning
   bị chặn, coverage chaincode đạt, production/container và Fabric integration.
4. Sau merge, xác nhận mọi job được chọn trên push main và cùng SHA đều đạt,
   rồi dùng evidence này cho UAT CD. Release/deployment theo approval và
   runbook hiện có; không coi báo cáo local là nghiệm thu release.

Lệnh và chính sách chi tiết được cập nhật trong [docs/ci.md](ci.md).
