# Production-only đã triển khai — 13/10/2026 (UTC+7)

Chỉ đạo người dùng ngày 12/10: bỏ deployment dev/nongtrace.site, gỡ CI/CD ở dev,
dành VPS cho production, tiếp tục Hybrid và push trực tiếp main với kế hoạch/
evidence bằng Markdown. Đây là kết quả thực tế của bước chuyển môi trường;
Hybrid A → B → C vẫn đang triển khai, chưa nghiệm thu toàn bộ.

## Source và CI/CD

Main cleanup: `8ae13542aee92b47d7ed64a0d83d560dbb517dc3`; dev cleanup:
`6be14c2b6efb1c706454c9619609d44a5ae5f608`. Push atomic fast-forward, giữ lịch sử
hai nhánh và nguyên app/schema của mỗi nhánh; không force hoặc sửa checkout
Desktop/main dirty của người dùng. Main vẫn có 14 applied migrations; Hybrid
draft/schema chưa đưa lên production.

Dev/UAT CD workflows, development descriptor/provision/toggle/resume, dev
ingress/Caddy route và test lifecycle đã bỏ. Chỉ main là deployable, Fabric là
profile bắt buộc. Giữ checksums, exact-SHA gates, immutable image labels/digests,
backup, history/proof/hash và rollback/recovery guards. CI push/PR chỉ vào main;
đầu nhánh dev cũng đã gỡ triggers cũ, không tạo lại deployment environment.

Trước push: 73 Python Linux + 37 Node deployment/transport Linux + 18 CI selection
Windows + 5 YAML parsed đạt. Fixture LF và prefix prod-backup sửa theo contract,
giữ 0600/exclusive download/retry assertions. Đúng main SHA đã đạt
[Application CI](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38276633302),
[Blockchain CI](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38276633227) và
[Dependency Audit](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38276633201).

## Runtime dev đã retire

Dev delivery GitHub/server disable trước backup, không có rollout/journal mở.
Snapshot giữ 13 ledger events/Pending 0; PostgreSQL/ledger/identities/config và
receipts mã hóa đã tải off-VPS, giải mã/checksum verified, plaintext gỡ. Giữ
hashes/thư mục private trong
[transition plan](plans/production-only-transition-2026-10-12.md).

Đã gỡ 16 dev containers, ba networks, route nongtrace.site, GitHub development
environment và quyền key/sudoers/entry dev. Cold archives/volumes giữ backup,
không có runtime dùng CPU/RAM; không prune Docker host hoặc xóa lịch sử dữ liệu.
Dev observation đóng false theo retirement, giữ mọi gap/failure, không đổi thành
nghiệm thu 24h. Tài nguyên test chuyển local/runner, không dựng lại dev trên VPS.

## Production release và hậu kiểm

Release đang chạy: `prod-8ae13542aee92b47d7ed64a0d83d560dbb517dc3`,
`agritrace.dev`, project/PGDATA vẫn `agri-trace-uat` /
`agri-trace-uat_postgres-data`, channel agritrace/sequence 3. Fingerprint chaincode
không đổi, không upgrade/reset ledger hoặc thay identity để vượt gate.

[CD đầu](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38278770033)
dừng compose-preflight trước journal/stop writers: legacy overlay hard-code năm
Fabric variables trong khi shared env chưa có. Adopt đúng values của current
Worker và đối chiếu trusted descriptor, giữ private bytes/runtime, preflight
pass. [CD retry](https://github.com/KieuTanPhat/agri-trace-blockchain/actions/runs/38281981598)
đạt và encrypted snapshot đã lưu off-VPS qua Actions artifact. Giữ failure trước
đó và lỗi thiếu snapshot của preflight, không ghi chúng là rollback/deploy pass.

Hậu kiểm UTC17:43:48 ngày12/10 (00:43:48 ngày13/10 UTC+7):

- Image digests/revision/production labels đúng; API không signer/mount, Worker
  signer mounts readonly. Không OOM hoặc restart ngoài lifecycle đã chủ ý.
- 118 fingerprints cũ giữ nguyên; tổng hiện có 120 gồm canary mới. 209 identity
  files giữ nguyên. Direct ledger 60 events, Pending 0, 2 QR verified và 6 QR
  legacy đúng catalog. Health/roles/session/proof/hash/history/QR đạt.
- Compose recreate PostgreSQL/API/Worker/Web và snapshot dừng/resume sáu Fabric
  nodes + hai chaincodes theo thiết kế; PGDATA/ledger/keys giữ nguyên. Ba container
  ngoài phạm vi lifecycle giữ ID/start/restarts/state. Journal/runtime toggle clear.
- Encrypted snapshot SHA-256
  `5da9b7f35b1bf3977569bc2168ef6be2a133b4813f6d13a668fbb0c25f223dd1`.
  Observation release mới chưa đạt window; không suy healthy trong gap.

Receipt root-private: `/opt/agri-trace-admin/production-only-transition-20261012/`
và `.codex/production-only-*`. Vận hành theo
[production runbook](production-runbook.md). Chưa có partner thật: Fabric kỹ thuật
hiện có chưa là authority CA/peer/admin/signer của doanh nghiệp thật.
