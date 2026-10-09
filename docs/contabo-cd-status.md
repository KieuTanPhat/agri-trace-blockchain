# Kết quả kiểm chứng CD UAT Contabo — 08/10/2026

Báo cáo này giữ evidence của giai đoạn CD HTTP. Runtime HTTPS hiện hành,
source/digests và kiểm chứng ngày 09/10 nằm trong
[nongtrace-uat-deployment-status.md](nongtrace-uat-deployment-status.md).

Đã hoàn thành CD trên VPS `13.140.170.166`: ba CI đúng commit, publish GHCR,
deploy/verify, rollback, redeploy, upgrade chaincode và backup ngoài VPS đều đạt.
Kế hoạch/review: [contabo-cd-plan.md](contabo-cd-plan.md).
Vận hành: [contabo-cd-runbook.md](contabo-cd-runbook.md).

## Release trong lượt kiểm chứng HTTP

- Source SHA: `dbeb65b83023d0631f1ae0943253139fcf94873d` trên main.
- Current: `/opt/agri-trace/releases/uat-dbeb65b83023d0631f1ae0943253139fcf94873d`;
  `/opt/agri-trace/current` trỏ tới release này.
- Previous đã verified: `uat-c1a69edbf95daf28ed441e05337d6b50ec0e9553`.
- API/Worker: `ghcr.io/kieutanphat/agri-trace-blockchain/api@sha256:d92bee9243c12bdaaf4238192ddead02a751c517ac051f6706eaf9cfa272c277`.
- Web: `ghcr.io/kieutanphat/agri-trace-blockchain/web@sha256:a921b66bb0df21126ed674a27f8a4ae19f9b13e6042206a13e2a9bef3247d6b1`.
- Fabric sequence `2`, version `cd-dbeb65b83023`; hai peer cùng package
  `agritrace-dbeb65b83023d0631f1ae0943253139fcf94873d:398dfa62457712a38bcb8c802289fe91e26210b97f5398a61778199e8e2a45f9`.
- `recoveryRequired=false`; khoảng 76.98 GiB đĩa trống khi kiểm cuối.

Runtime Fabric/MSP/TLS vẫn ở release manual gốc
`uat-20261007-c1a69ed-893ca0d7e1d1`; giữ thư mục này vì các bind mounts còn dùng.
Đợt cập nhật báo cáo chỉ thay docs, không đổi source SHA của runtime.

## Bằng chứng GitHub của đúng SHA runtime

| Kiểm tra | Run | Kết quả |
| --- | --- | --- |
| Application CI | [37660582391](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37660582391) | Success, có probe migration của controller trên PostgreSQL CI |
| Blockchain CI | [37660582296](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37660582296) | Success, có API–Worker–Fabric integration |
| Dependency Audit | [37660582310](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37660582310) | Success |
| CD push main | [37660582261](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37660582261) | Gate, publish, delivery, canary và encrypted artifact success |
| Rollback tới baseline | [37662179310](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37662179310) | Success; giữ canary và toàn bộ 41 sự kiện |
| Redeploy cùng SHA | [37662587430](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37662587430) | Success; reuse digest, không nhân đôi canary |
| Upgrade, expected_sequence=1 | [37663105551](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37663105551) | Hai org approve, commit/query hai peer sequence 2; verify success |
| Recover khi không có journal | [37663819290](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/37663819290) | Success, no-recovery-required |

Các bản sửa đã review/merge qua PR [58](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/58),
[59](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/59),
[60](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/60) và
[61](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/61).

## Dữ liệu và kiểm chứng cuối

5 users/roles; 14 organizations; 4 farms; 3 plots; 4 products; 5 production
cycles; 6 harvests; 6 lots; 6 shipments; 41 events/outbox/proofs.
Baseline có 40 events/4 cycles; CD thêm đúng một ProductionCycle canary theo
Idempotency-Key của SHA. Rollback/redeploy/upgrade giữ lại canary.

Verifier sau upgrade đã kiểm năm role login/me và AUDITOR write forbidden,
41 event/proof qua truy vấn Fabric trực tiếp và API hash verification,
20 entity heads/histories, sáu public QR/timeline VERIFIED và HTTP QR 200.
Toàn bộ outbox COMPLETED/proof CONFIRMED, dead-letter 0, Worker ready,
Swagger HTTP 404. Fingerprint/counts trước mỗi transition được bảo toàn.

Web: <http://13.140.170.166/login>. Health: <http://13.140.170.166/api/health>.
Evidence private trên VPS: `/opt/agri-trace/cd/final-evidence.json`,
`restore-check.json`, records/state/last-result và operations log.

## Backup và phục hồi đã kiểm

- Snapshot coherent gồm PG custom dump, ba Fabric ledger volumes,
  identities/config, baseline và release metadata; kiểm checksum năm thành phần.
- Artifacts CMS AES-256-GCM của deploy, rollback, redeploy và upgrade đã tải từ
  Actions về máy Phát, giải mã và kiểm đủ năm checksum thành công.
- Artifact rollback có 41 events, được restore vào PostgreSQL mới cô lập:
  đủ tám migrations, mọi counts và event/proof fingerprints khớp. Container
  và anonymous volume kiểm thử được xóa sau assert label riêng.
- Bản sao ngoài VPS nằm trong
  `C:\Users\kieup\.agri-trace-uat\cd\actions-<run-id>-backup` (ACL owner/System).
  Private recovery key ở folder `cd`, không nằm trên VPS/GitHub/repo.
  Artifacts Actions giữ 30 ngày; lưu bản tải local cùng recovery key.

## Các lỗi đã xử lý và mức kiểm chứng

- SSR QR dùng loopback trong container CI: chuyển server sang API nội bộ Docker,
  browser giữ public origin; sáu QR HTTP rehearsal và CI đạt.
- Token job thực tế 377 bytes vượt guard cũ 300: nhận opaque credential có giới
  hạn, username explicit, truyền SSH stdin/temp Docker config rồi xóa.
- Tám migration manual CRLF khác hash Git LF: đối chiếu toàn bộ source/DB,
  áp dụng cách nhận LF/CRLF của Prisma; giữ nguyên SQL và checksum catalog DB.
- Cờ `--no-build` không có ở `compose run`: sửa command và đưa chính method
  migration vào container CI. Lượt lỗi đã thực sự rollback/verify về baseline;
  backup của lượt đó vẫn upload, decrypt và restore thành công.
- GitHub có một lượt lỗi nội bộ trước khi tạo gate và API rerun HTTP 500.
  Lượt CI mới cùng code đã đạt; các lần merge tiếp theo giữ đủ ba gate.

19/19 policy/controller tests và 10/10 Node gate/SSH transport tests Linux đạt;
actionlint đạt. Failure/recover unit tests có trường hợp gián đoạn sau promote
state nhưng trước xóa journal, phục hồi đúng package cũ bằng sequence cao hơn.
Khóa CD restricted đã gọi status và từ chối shell tùy ý. Bốn hash helper cài
trên VPS khớp manifest Git; 405 file/thay đổi riêng ngoài scope vẫn nguyên vẹn.

## Giới hạn bàn giao

Demo/UAT HTTP IPv4 trên một VPS, có gián đoạn ngắn khi snapshot/rollout.
Domain/HTTPS là bước sau theo lựa chọn đã thống nhất. Restore PostgreSQL và
checksum Fabric archives đã kiểm; chưa diễn tập restore vật lý Fabric sang
host thứ hai hoặc live crash trong lúc commit definition. Rollback definition
khác fingerprint/recover gián đoạn được kiểm bằng unit tests; upgrade thật
diễn tập với cùng code chaincode để giữ nguyên nghiệp vụ. Không tự đóng AGT
Issue hay ghi nhận nghiệm thu nghiệp vụ thay reviewer.
