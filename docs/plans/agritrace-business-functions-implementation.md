# Kế hoạch triển khai chức năng nghiệp vụ AgriTrace

Chủ dự án đã yêu cầu ngày 18/10/2026: lập kế hoạch rồi triển khai, không chờ duyệt
lại. Nguồn phân tích: [đề xuất và khảo sát iCheck](agritrace-business-functions-proposal.md).
Kế hoạch áp dụng P0/P1 B01–B15 và B17. B16 là các mở rộng P2 đã tách riêng trong
đề xuất (serial chống giả, chế biến/trộn nguồn, tự vận chuyển, thiết bị ngoài).

## Quyết định thực hiện

- Giữ CROP, bốn năng lực tổ chức và đường Shipment hiện có. Admin điều phối,
  không ký/ghi nghiệp vụ thay doanh nghiệp.
- Mã tổ chức độc lập MST. Quyền theo thao tác, chuỗi và cơ sở; thành viên cấp
  2/3 không được vượt người ủy quyền. Case có quyền riêng, mọi loại tổ chức dùng được.
- Tồn cơ sở là phân bổ con của tổng tồn tổ chức. Mọi ghi giảm, giữ chỗ và giao
  nhận phải khớp cả hai tầng; lượng chưa phân bổ được nêu rõ và chỉ chủ quản phân bổ.
- Thực nhận và phần chờ đối soát được phân biệt. Không mặc định thiếu là hỏng;
  trả hàng cần chặng bàn giao thật. Thu hồi nguồn khác với cách ly tại cơ sở.
- DUAL_SIGNED phải đi qua signed intent c2 và ledger validation tương thích;
  giữ guard đóng đến khi tích hợp đạt yêu cầu, không coi chữ ký UI là proof Fabric.
- Kích hoạt dịch vụ qua quyết định có audit và version; thanh toán mô phỏng local
  không là bằng chứng thanh toán thật. Kết nối peer vẫn cần kiểm chứng độc lập.
- Danh mục/hồ sơ có revision; evidence thêm mới/đính chính, không viết lại event
  đã hash. Nhập hàng loạt chỉ nhập danh mục, không nhập lượng hoặc lịch sử.
- Quyết định chủ dự án: admin kích hoạt thủ công và ghi lý do; phần chưa nhận
  thuộc trách nhiệm vận chuyển đến khi có bàn giao trả với hai chữ ký. QR công
  khai hiển thị lượng dự kiến, thực nhận và đang đối soát. Thay đổi pháp lý/năng
  lực cần admin duyệt lại; mô tả và liên hệ lưu revision.
- Quyết định chủ dự án (18/10, tiếp tục tác vụ): chuyển chủ quản cấp 1 chỉ có
  hiệu lực khi người được chỉ định chấp nhận; người chuyển tự chọn giữ hoặc bỏ
  quyền cấp 1. Lịch sử in tem QR lưu trên server (người in, số tem, mẫu, lý do in
  lại); số tem in không chứng minh lượng hàng.

## Các bước và điều kiện hoàn thành

| Bước | Phạm vi | Kiểm chứng bắt buộc |
| --- | --- | --- |
| 1 | B01–B03, B09: mẫu quyền, mã tổ chức, hộp việc và API actions | API scope/replay, Web menu và case của cả bốn tổ chức |
| 2 | B04–B06: tồn cơ sở, biên bản nhận/sai lệch/trả, cách ly/thu hồi | PostgreSQL đã migrate: balance, cạnh tranh, scope A/B, replay và in-transit recall |
| 3 | B07–B08: c2 và kích hoạt | Không downgrade; tamper/replay/stale authority; Fabric thật khi đủ môi trường |
| 4 | B10–B13, B17: revision/evidence/vật tư/mời thành viên/import | Quyền, lịch sử, file policy, tự kích hoạt, duplicate/import recovery |
| 5 | B14–B15: bán lẻ, QR, hướng dẫn/báo cáo/thông báo | Cùng scope xem/xuất, ngày Việt Nam, lỗi mạng, responsive/accessibility |
| 6 | Hoàn thiện contract/docs và kiểm tra tích hợp | Prisma/API contract, lint/typecheck/unit/E2E/build; ghi rõ phần runtime chưa chứng minh |

## Tiến độ

- [x] Đọc toàn bộ chữ và 117 URL ảnh của trang tham khảo, đối chiếu source local.
- [x] Xác định phạm vi và quyết định triển khai theo ủy quyền mới.
- [x] Bước 1 (source + harness trực tiếp; hộp việc gồm giao nhận, lô bị chặn,
  chuyển quyền và case).
- [x] Bước 2 (source + harness trực tiếp trên PostgreSQL cách ly).
- [x] Bước 3 mức ledger: kích hoạt thủ công đã có; c2 nghiệm thu trên Fabric thật
  (8/8). Đường API → Worker → Fabric cho c2 chưa chạy, feature gate giữ đóng.
- [x] Bước 4 (source + harness; tải file hồ sơ qua trình duyệt chưa kiểm).
- [x] Bước 5 (source + harness; kiểm trình duyệt một phần, xem bên dưới).
- [ ] Bước 6: contract/lint/typecheck/build và harness đạt; bộ test có sẵn chưa chạy
  theo chỉ đạo chủ dự án.

## Môi trường và bảo toàn

Checkout có nhiều thay đổi chưa commit trước tác vụ; giữ các thay đổi này, không
reset hay thay migration cũ. Chỉ thêm migration. DB/Fabric kiểm thử phải được tạo
riêng và xác nhận ownership; không dùng database hai stack demo/review đang chạy.
Không tự deploy, merge, gửi mail ngoài hoặc sửa dữ liệu production. Chỉ một job
nặng local mỗi thời điểm. Kết quả kiểm source, PostgreSQL, browser và Fabric được
ghi tách biệt; compile/mock không thay nghiệm thu runtime.

Chỉ đạo bổ sung: bỏ các bộ test có sẵn trong source; kiểm trực tiếp bằng harness
riêng qua HTTP/SQL trên môi trường sở hữu. Vẫn generate contract, lint/typecheck
và build. Khi chưa rõ quy tắc nghiệp vụ, hỏi chủ dự án và tiếp tục phần độc lập.

## Trạng thái sau khi tiếp tục tác vụ — 18/10/2026

Công việc vẫn chưa commit, merge hay deploy. Checkout giữ nguyên các thay đổi có
trước; chỉ thêm migration mới, không sửa migration đã áp.

- Hồ sơ: doanh nghiệp sửa liên hệ có revision, tải giấy tờ pháp lý riêng tư
  (`PROFILE`), gửi/rút điều chỉnh pháp lý; admin so sánh bản hiệu lực với bản đề
  nghị và duyệt/từ chối có audit. Hồ sơ bị từ chối gửi lại từ trang xét duyệt.
  Sửa lỗi DTO evidence trước đây không nhận `PROFILE`.
- Chuyển chủ quản: `20261108000000_enterprise_ownership_transfer` thêm yêu cầu
  có hạn 7 ngày; guard enrollment/phân cấp chỉ cho đổi chủ và cấp trong đúng
  transaction chấp nhận. Bỏ quyền cấp 1 thì thu hồi grant, chuyển cấp dưới trực
  tiếp sang người nhận và thu hồi phiên của người chuyển.
- Tem QR: `20261109000000_trace_label_prints` lưu lịch sử in append-only; in lại
  cần lý do; lô thu hồi/hết hạn/bị chặn không phát hành tem mới. Mẫu tem tiêu
  chuẩn/nhỏ gọn ghi rõ là tem truy xuất theo lô, không phải tem chống giả.
- Hộp việc `/distribution/tasks`: việc ký đồng thuận/lấy/giao, biên bản thực
  nhận, ký trả hàng, đối soát phần chưa nhận, lô thu hồi/hết hạn/sắp hết hạn/cách
  ly; lọc theo cùng phạm vi chuỗi–cơ sở với chi tiết/báo cáo.
- Rà soát phân bổ (kiểm quyền cơ sở nguồn), cách ly, biên bản, trả hàng hai chữ
  ký và khóa lô/chặng: không phát hiện lỗi mới.

Bằng chứng trên source hiện tại (chưa có SHA vì chưa commit):

- `api-contract:check` khớp 245 operation; lint/typecheck API và Web, build API
  và build Next.js đạt.
- Harness HTTP/SQL riêng trên PostgreSQL cách ly của tác vụ (43 migration) đạt
  24 kiểm tra: luồng 1.000 → 600 giao / 590 nhận / 10 trả hai chữ ký, cân bằng
  795 + 200 bán + 5 hao hụt, replay receipt/in tem/chấp nhận chuyển quyền, hộp
  việc theo từng bước, quyền in tem, chuyển chủ quản, điều chỉnh hồ sơ và các SQL
  guard append-only/chống đổi chủ hoặc pháp lý trực tiếp. JWT được ký trực tiếp
  nên harness không kiểm đăng nhập/MFA.
- Trình duyệt local (API :8085 + Web :3005 trên DB cách ly): sửa liên hệ, tạo và
  chấp nhận chuyển chủ quản bằng hai tài khoản, hộp việc của người nhận, danh
  sách/chi tiết duyệt điều chỉnh của admin ở desktop và 390 px.

Bổ sung lần hai (18/10/2026, theo yêu cầu làm toàn bộ trừ commit):

- Rà B01–B17 với source: mẫu quyền, mã AGT, case, tồn cơ sở, biên bản/trả,
  kích hoạt, revision/evidence, vật tư và cảnh báo cách ly theo nhật ký, mời và
  khôi phục khóa ký, import đều có source và Web consumer.
- B14: thêm mục menu "Ghi bán & hao hụt" theo quyền `quantity.adjust`.
- B15: số việc đang chờ hiện trên menu "Hộp công việc" (thông báo trong ứng
  dụng); `/distribution/tasks` đếm thêm yêu cầu chuyển chủ quản. Email nhắc việc
  theo cấu hình chưa làm, cần chốt người nhận/tần suất/opt-in.
- C2 trên Fabric thật: instance cách ly `agri-functions-c2` (WSL, cổng +300,
  chaincode `func-c2#1` từ working tree) đạt 8/8: chữ ký hợp lệ được ghi; thiếu
  chữ ký, ký sai lô/loại/chuỗi/sự kiện, đổi snapshot lượng, đảo chữ ký, phát lại
  intent, trùng sự kiện và khóa đã thu hồi đều bị chaincode từ chối; các loại
  sự kiện phân phối mới không ký được nhận. Phiên bản chaincode mới cần quy trình
  nâng cấp chaincode riêng trước khi dùng ngoài môi trường cách ly.
- Harness HTTP/SQL đạt 25/25 trên source cuối.
- Stack review cổng 3001 được đồng bộ sau sao lưu `pg_dump` (artifact local):
  áp 7 migration còn thiếu (20261103–20261109), khởi động lại API/Worker, build
  lại image Web; image cũ giữ tag `agritrace-review-web:pre-functions-*`.

Khoảng trống còn lại:

- Bộ test có sẵn trong source không chạy theo chỉ đạo chủ dự án; chưa có test tự
  động mới cho các luồng trên.
- C2/DUAL_SIGNED vẫn có feature gate; đã nghiệm thu mức ledger, chưa chạy đường
  API → Worker → Fabric và cạnh tranh khi ký.
- Chưa kiểm qua trình duyệt: tải file giấy tờ, in tem thực tế trên máy in,
  viewport 320/768 và bàn phím cho toàn bộ trang mới.
- Người chuyển bỏ quyền cấp 1 vẫn giữ tài khoản nhưng không còn quyền nghiệp vụ;
  người nhận mới cần cấp lại nhóm quyền nếu muốn dùng tài khoản đó.

Container PostgreSQL riêng `agritrace-functions-20261018-pg` được dừng sau khi
kiểm, giữ dữ liệu để kiểm tiếp. Harness, dữ liệu UI và cấu hình cách ly nằm trong
artifact local của tác vụ; không đưa thông tin kết nối, mật khẩu test hoặc
evidence vào commit.

## Tiếp tục theo `aaa.txt` và ảnh mẫu — 19/10/2026

Chủ dự án xác nhận áp dụng toàn bộ tài liệu cho cả admin/doanh nghiệp, làm trên
nhánh hiện tại, không chạy bộ test có sẵn. Vụ tạo trước chuỗi là nháp; chỉ sau
liên kết mới ghi nhật ký/thu hoạch. Danh bạ đối tác ngoài AgriTrace là tham chiếu,
không cấp quyền phân phối. Chủ dự án chọn kiểm qua API khi quyền điều khiển trình
duyệt local bị tắt. Quyết định này thay thế các giả định trước đó về phạm vi UI,
kiểm thử và DB cách ly: chỉ dùng DB review hiện có, tài khoản hiện có, không tạo
tài khoản hoặc DB mới.

Source đã thêm hồ sơ sản phẩm/vùng/vật tư/giống/cơ sở có ảnh và cổng kích hoạt;
vụ nháp và liên kết; ảnh bắt buộc cho nhật ký/thu hoạch/lô; phân bổ tồn ngay ở cơ
sở lưu giữ ban đầu; danh bạ ngoài hệ thống; trường hồ sơ thành viên/lời mời và
chứng cứ riêng tư; lịch dự kiến giao nhận nằm trong snapshot chữ ký phiếu mới;
ngừng hồ sơ chuỗi có guard giao dịch chưa hoàn tất. Giao diện admin và doanh
nghiệp dùng sidebar tối, thẻ dữ liệu thật và form theo nghiệp vụ. Migration
`20261110`–`20261122` đã áp lên DB review sau backup local; không sửa migration đã
áp trước đó.

Kiểm trực tiếp HTTP trên API source cổng 8085 và PostgreSQL review: đăng nhập
tài khoản seed; sản phẩm thiếu 3 ảnh bị 409; vụ nháp từ chối nhật ký 404, liên
kết giữ UUID và metadata, idempotency replay không tạo bản trùng; giống ngoài tổ
chức bị 422; ảnh vụ tải và đọc được; thiếu ảnh nhật ký 403/thu hoạch 422; thu
hoạch stale version 409; nhật ký và thu hoạch hợp lệ tạo event/lô/QR và sao ảnh
lô; lô 7 kg chọn kho ban đầu hiển thị đúng 7 kg khả dụng tại kho. Chức danh
thành viên thiếu bị 400, cơ sở sai bị 409, ảnh đại diện tải/đọc lại có SHA-256
khớp. Phiếu thiếu ngày lấy bị 400, ngày giao trước ngày lấy bị 422. API contract
256 operation, build API, lint API/Web và typecheck Web đạt. Bộ test có sẵn không
chạy theo chỉ đạo.

Giới hạn nghiệm thu: chuỗi Tân Phú dùng doanh nghiệp seed legacy không có hồ sơ
enrollment đã duyệt, nên không thể tạo liên kết đối tác hợp lệ để kiểm phiếu giao
nhận mới dương tính trên chuỗi này. Đường API → Worker → Fabric c2 vẫn theo gate
hiện hành, chưa nghiệm thu ở lần này. Sau khi browser local bị tắt, các màn hình
mới chỉ được kiểm contract/build/API, chưa duyệt lại responsive bằng browser.

### Bàn giao tiếp tục — 19/10/2026

- Nhật ký và thu hoạch hiện nhận 1 ảnh chính cùng tối đa 4 ảnh bổ sung; lưu danh
  sách UUID vào bản ghi mới và hash ảnh vào trace event. API đã kiểm trực tiếp:
  ảnh trùng bị 422; nhật ký hai ảnh và thu hoạch hai ảnh tạo thành công; người
  đại diện sai bị 422, người được phân công hoặc tài khoản đang ghi được ghi vào
  bản ghi cùng tên chụp tại thời điểm thu hoạch. Các bản ghi lịch sử giữ nguyên.
- Migration `20261123` thêm mảng chứng cứ và người đại diện; `20261124` thêm mã
  thu hoạch tự sinh. Lần áp đầu của `20261123` bị guard bất biến chặn do lệnh
  cập nhật lịch sử; đã bỏ lệnh đó, đánh dấu lần lỗi rolled back và áp thành công
  trên DB review. Không đổi dữ liệu thu hoạch cũ.
- Ảnh chuỗi `CHAIN_IMAGE` đã có API, quyền sở hữu chuỗi và panel trên trang chuỗi.
  Kiểm trực tiếp đầu tiên bị 403 vì preflight vẫn đòi chuỗi đang hoạt động khi
  chuỗi test đã ngừng. Đã sửa preflight cho ảnh hồ sơ chuỗi và build API đạt;
  **cần chạy lại kiểm API** với source API cổng 8085. Chưa kiểm mã thu hoạch mới
  qua API. Web typecheck/lint và build Next cần chạy lại sau thay đổi cuối.
- Source API cổng 8085 đang chạy trên DB review, health/live trả 200; Web dev
  cổng 3005 có thể còn chạy. Contract đã sinh 256 operation. Không chạy bộ test
  có sẵn theo chỉ đạo chủ dự án. Không commit; tiếp tục trên nhánh hiện tại,
  giữ toàn bộ thay đổi có sẵn trong checkout.

### Claude tiếp tục — 19/10/2026

- Kiểm lại theo bàn giao: ảnh chuỗi bị 500 do CHECK của `trace_evidence` thiếu
  `CHAIN`/`CHAIN_IMAGE`; thêm migration `20261125` (không sửa `20261121`). Sau đó
  script kiểm của Codex đạt: tải và đọc ảnh chuỗi 201/200, thu hoạch 201 với mã
  `TH-…`.
- Đối chiếu `aaa.txt` với DTO/schema. Chủ dự án chọn làm phiếu chuyển kho có trạng
  thái (mục 1.2) và phiếu cách ly riêng (mục 1.3). Migration `20261126` thêm
  `site_transfer`, `quarantine_case`, guard bất biến/chuyển trạng thái và guard cân
  bằng hoãn kiểm; `20261127` thêm trường tùy chọn của sản phẩm, nhật ký chăm sóc
  (người thực hiện, tình trạng cây) và sản phẩm liên kết của chuỗi. Trace dùng lại
  event type sẵn có (`DISTRIBUTION_SITE_ALLOCATED`, `DISTRIBUTION_QUARANTINE_RECORDED`,
  `DISTRIBUTION_QUANTITY_RECORDED`) nên chaincode không đổi. Phân bổ tức thời giữa hai
  cơ sở (`fromSiteId`) nay bị từ chối, phải dùng phiếu chuyển kho.
- Kiểm HTTP trên API source cổng 8085 với DB review (đã pg_dump trước mỗi migration),
  tài khoản seed `farm.staff`: 33/33 kiểm đạt, gồm phiếu chờ/hủy không trừ kho, chuyển
  vượt khả dụng 409, xuất trừ kho nguồn, replay cùng key trả cùng phiếu, lượng đang
  chuyển không thành chưa phân bổ, version cũ 409, thực nhận vượt 409, chênh lệch trả
  về kho nguồn, chênh lệch ghi hao hụt giảm tổng lô 0,4 kg, cách ly thiếu nguyên nhân
  422, giải tỏa một phần theo phiếu, giải tỏa không chọn phiếu 409, ghi hư hỏng đóng
  phiếu, ảnh phiếu chuyển/cách ly, chuỗi với sản phẩm ngoài doanh nghiệp 422, người
  thực hiện ngoài phân công 422. Guard SQL thử trong transaction ROLLBACK: sửa nội dung
  phiếu, xóa phiếu cách ly, chuyển trạng thái ngược và vượt cân bằng đều bị chặn. Dữ
  liệu kiểm (cơ sở "Kho kiểm tra chuyển nội bộ", các phiếu `CK-…`/`CL-…`, nhật ký và
  thu hoạch 0,5 kg) nằm lại trên DB review.
- Web: trang `/enterprise/inventory` có bốn thẻ (tồn theo cơ sở, phân bổ, chuyển kho,
  cách ly) với thao tác xuất/nhận/xử lý chênh lệch/hủy, giải tỏa/ghi hư hỏng và ảnh
  chứng từ; form sản phẩm, nhật ký chăm sóc và tạo chuỗi có trường mới. Contract 263
  operation; typecheck, lint API/Web và `next build` đạt. Đã xem trang tồn kho bằng
  trình duyệt local ở desktop và 375 px. Bộ test có sẵn không chạy theo chỉ đạo.
- Chưa nghiệm thu: đường API → Worker → Fabric cho các event mới; form sản phẩm,
  nhật ký và chuỗi mới chỉ kiểm qua API/typecheck, chưa thao tác trên trình duyệt;
  phiếu giao nhận ba bên dương tính vẫn bị giới hạn bởi dữ liệu seed như ghi ở trên.
  Bộ test có sẵn (`harvest-recovery.spec`, `harvest-dialog.spec`…) đang lệch với
  validation thu hoạch mới và cần cập nhật khi được phép chạy.
- Hộp thư nội bộ: migration `20261128` (`enterprise_message_thread`, `enterprise_message`
  bất biến, `enterprise_message_participant`), API `/enterprise-messages`. Kiểm HTTP với
  tài khoản review HTX Bình Minh: 13/13 đạt (nhân viên không có `members.manage` gửi
  403, người nhận ngoài doanh nghiệp 422, replay cùng key không trùng, người ngoài cuộc
  không đọc/trả lời được 404, đánh dấu đã đọc, trả lời làm chủ thread thấy chưa đọc,
  trả lời rỗng 400). Contract 268 operation.
