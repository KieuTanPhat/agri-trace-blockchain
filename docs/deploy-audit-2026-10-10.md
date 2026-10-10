# Audit và sửa luồng deploy — 10/10/2026

Cập nhật sau audit: UAT đã cutover core `53bec18` lúc 20:42 ICT ngày 10/10,
cài đủ helper được review, 14 migration và Fabric sequence 3.
[Báo cáo triển khai](uat-core-deployment-2026-10-10.md) ghi evidence và giới hạn
nghiệm thu. Các blocker vận hành bên dưới là trạng thái lịch sử trước cutover.

Baseline source: `4826dc60d6c386f5bea303c8c1ab17a2575b051f`.
Liên quan [AGT-031](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/43)
và [AGT-005](https://github.com/KieuTanPhat/agri-trace-blockchain/issues/17).
Phạm vi: code deploy, kiểm thử, PR và merge; chưa phê duyệt cutover/migration
core trên VPS. Checkout Desktop có thay đổi của người dùng được giữ nguyên.

## Phát hiện và kế hoạch

| Mức | Lỗi được xác nhận | Sửa và bằng chứng cần có |
| --- | --- | --- |
| P1 | Verifier hiện hành yêu cầu cookie session family ngay khi kiểm baseline, trong khi API UAT `8bbf009` trả refresh token trong JSON. Cài controller mới sẽ làm baseline thất bại trước rollout. | Verifier dùng đúng credential của release cũ khi kiểm baseline/rollback, nhưng bắt buộc family cookie cho candidate và các release đã được đánh dấu theo contract mới. Test login/rotation/logout và từ chối downgrade. |
| P1 | Verifier logout phiên Admin rồi tiếp tục dùng JWT của phiên đó để kiểm proof; auth hiện hành revoke toàn bộ family nên trả 401. | Test rotation/logout bằng phiên Auditor sau kiểm quyền, giữ phiên Admin để kiểm ledger/QR; kiểm JWT đã logout trả 401. Chỉ 5 login mỗi lần verify để không vượt rate limit khi kiểm baseline + candidate. |
| P1 | Process chết khi snapshot đang dừng Fabric bỏ qua `finally`; `recover` query peer trước khi khởi động Fabric. Migration history còn được kiểm sau khi mở lại writers. | Resume và đợi Fabric trước reconcile; kiểm migration history trước khi mở API/Worker. Test snapshot bị ngắt, peer chưa ready và migration không rõ. |
| P1 | Rollback tự động khi migration thất bại cũng mở writers trước khi kiểm `_prisma_migrations`, có thể phục vụ với schema chạy dở. | Dùng cùng kiểm migration history cho recovery và rollback tự động; nếu chưa finished giữ writers dừng, journal còn nguyên. |
| P1 | Rollout xóa journal trước khi ghi kết quả bền vững. Lỗi ghi kết quả rồi rollback thất bại có thể mất đường recover. | Giữ journal đến khi ghi kết quả thành công; test lỗi persistence sau promote và rollback thất bại. |
| P2 | SSH key/known-hosts được ghi trước `try/finally`; thiếu known-hosts hoặc lỗi ghi file có thể bỏ lại key. | Đưa mọi thao tác ghi secret vào vùng cleanup và báo lỗi cấu hình không lộ giá trị; test missing inputs, write failure, SSH failure. |
| P2 | Migration mới được hash từ `read_text()` đã chuẩn hóa newline, trái với checksum bytes trong manifest; script CRLF hợp lệ bị từ chối. | Hash bytes chính xác rồi decode để kiểm SQL; test LF/CRLF và thay đổi bytes vẫn bị chặn. |

Snapshot cũng phải giữ phase lỗi gốc khi Fabric resume thành công, để log không
gán nhầm lỗi backup thành lỗi resume.

## Review kế hoạch

Review lần đầu chưa đủ: chỉ phục hồi container và cleanup SSH không xử lý
được thay đổi contract auth giữa baseline/candidate, persistence sau promote,
hoặc việc mở writers trước kiểm migration. Kế hoạch phía trên bổ sung cả ba.

Review lần hai đạt về phạm vi: giữ exact-SHA CI, immutable images, controller
hash, signer chỉ ở Worker, backup trước migration, và không restore DB/ledger.
Credential legacy chỉ dùng cho release lịch sử; candidate không được dùng
fallback. Mọi helper chạy root (gồm `session-auth.mjs`) phải có checksum manifest và được installer
cài từ source đã review. Đây là tự review kỹ thuật, không thay signoff của
reviewer/người sở hữu AGT hoặc phê duyệt release thực tế.

## Kiểm chứng và review implementation

1. Tái hiện các lỗi bằng regression tests trước sửa.
2. Chạy Node tests và Python controller/policy/installer trên Linux, không skip
   các bài recovery/fsync/SSH vì Windows.
3. Review diff lần nữa, đặc biệt contract cũ/mới, journal, thứ tự mở writers,
   version metadata và cleanup secret.
4. PR phải đạt Application CI, Blockchain CI và Dependency Audit của head
   hiện hành; gồm production containers, PostgreSQL và Fabric integration.
5. Kiểm review threads, mergeability và SHA trước merge. Ghi evidence cuối
   trong PR; không đánh dấu các Issue AGT là Accepted từ việc merge code.

## Blocker vận hành cần giữ rõ

[UAT CD của baseline](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38046917051)
đạt CI gate và publish, nhưng delivery bị từ chối với
`CD controller changed; administrator must install the reviewed version before delivery`.
Status sau lỗi: current `uat-e786ef52538bff6eb49d09cb238aca0d1183102d`,
previous `uat-8bbf009c0cd43514ba07a5daa6407d697d537f9a`, sequence 2,
`recoveryRequired=false`. Không có snapshot mới vì lỗi xảy ra trước stop/backup;
các bước retrieve/upload backup sau đó cũng thất bại.

Cài controller/helper mới là bước quản trị độc lập theo CD runbook. Các migration
core `20261010*` có trigger/constraint/FK, cần kế hoạch cutover và compatibility
review riêng; không nới `additive_sql` để deploy tự động. Chaincode core cũng
cần operation `upgrade` với expected sequence đã đối soát. Bộ fix này không
biến bằng chứng source/CI thành bằng chứng UAT của core mới.

## Kết quả local và review phần đã sửa

- Linux (WSL Ubuntu / Python 3.12.3): **56/56** policy/controller/installer/
  packaging tests đạt, **0 skip**. Bao gồm fault injection khi snapshot bị ngắt,
  migration chạy dở, ghi kết quả sau promote thất bại, rollback/recover và checksum.
- Linux / Node **22.22.3**: **20/20** exact-commit gate/SSH/auth/verifier tests đạt,
  **0 skip**. Verifier chạy chính source đã ghép như controller, mô phỏng HTTP,
  PostgreSQL và Fabric; chứng minh baseline legacy, family candidate, logout
  revoke JWT và chặn candidate downgrade trước canary.
- Windows / Node **22.22.3**, npm **12.1.0**: cài sạch `npm ci`; `npm run test:ci`
  đạt **37 test, 3 skip SSH theo nền tảng**, cộng **3 verifier test** đạt.
  SSH đã chạy đủ trên Linux ở trên. Lockfile không đổi.
- YAML workflow/Compose parse được; `git diff --check` đạt.
- Review implementation đã sửa thêm việc dùng JWT sau logout và rollback tự
  động mở writers khi migration chưa finished. Test logout tái dùng phiên
  Auditor, không tăng số login gây lỗi throttling giữa baseline/candidate.
- Docker daemon local không sẵn sàng. Container/PostgreSQL/Fabric integration
  sẽ được kiểm bằng các CI bắt buộc của PR; không mô tả mô phỏng local là
  bằng chứng triển khai VPS hoặc nghiệm thu core.

Review local cuối không còn finding cần sửa trong phạm vi này. PR và CI đúng
SHA là cổng tiếp theo; kết quả và SHA merge được ghi trực tiếp trong PR.

## Rà soát tiếp sau PR #77

Baseline: `da6fee6fe4107fd24f9f84768f61b00dbfa77461`. PR #77 đã merge;
lượt này xử lý code còn thiếu trong các nhánh recovery. Hai finding P1:

| Lỗi | Kế hoạch đã review và cách sửa |
| --- | --- |
| Rollback tự động, rollback thủ công và recover có thể để API/Worker chạy sau khi startup một phần, verification, preservation hoặc state promotion thất bại. Journal yêu cầu recovery nhưng writers vẫn mở. | Bao toàn bộ transition khôi phục bằng cùng guard dừng writers khi có lỗi. Giữ phase lỗi gốc và journal; không ghi thành công khi cleanup stop thất bại. |
| Journal chỉ được kiểm trong `rollout`, sau transport và nhánh trả `unchanged` cho cùng SHA. Rerun một release đã promote nhưng chưa hoàn tất transaction có thể báo thành công mà chưa recover. | Kiểm journal ngay trước đọc credential/archive và trước nhánh cùng SHA; deploy/upgrade phải yêu cầu recover kể cả state đã promote. Status/backup vẫn đọc được. |

Review kế hoạch loại phương án chỉ dừng candidate: writer của release phục hồi
cũng có thể đã chạy hoặc chỉ API đã ready trước Worker lỗi. Guard vì vậy áp dụng
cho cả ba đường rollback/recover và bao cả verification/preservation/persistence.
Nếu Docker không dừng được writer, chỉ giữ journal và báo lỗi; không coi đó là
bằng chứng writer đã dừng. Đây là tự review kỹ thuật, chưa thay human signoff.

Regression trước sửa thất bại tại các ca writer vẫn chạy và journal không được
chặn trước đọc transport. Sau sửa, **63/63 test Python trên Linux (WSL Ubuntu,
Python 3.12.3), 0 skip** đạt. Bộ test thêm kiểm startup một phần, verifier từ
chối, lịch sử thiếu, promotion lỗi, Docker stop lỗi và rerun cùng SHA trước/sau
promotion. Các ca rollback/recover thành công hiện có tiếp tục đạt.

CI container/PostgreSQL/Fabric trên head PR là gate trước merge. Kết quả/SHA
cuối được ghi trong PR. Không thay migration SQL, chaincode, signer, image
hoặc dữ liệu UAT trong lượt sửa code này.

[UAT CD của merge #77](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38050864669)
đạt CI gate/publish nhưng delivery báo `Controller version metadata is missing`
trước stop/backup. Vẫn cần admin cài đủ helper từ source đã review và giữ gate
cutover core riêng; không nới kiểm manifest/migration để làm CD xanh.
