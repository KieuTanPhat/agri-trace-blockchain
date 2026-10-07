# Evidence CD UAT Contabo — 07/10/2026

Kế hoạch đã review: [contabo-cd-plan.md](contabo-cd-plan.md).
Vận hành: [contabo-cd-runbook.md](contabo-cd-runbook.md).

## Trước push

- Repo public, main/base c1a69ed, có admin/push; 3 CI base đều success.
- Environment uat chỉ main; private SSH key riêng, known_hosts pinned. Khóa
  forced-command đã gọi status thành công và từ chối `uname -a`.
- Controller adopt snapshot UAT: 5 roles, 40 direct ledger events, 6 verified
  QR, dữ liệu/counts/proof cũ khớp. Runtime Fabric/identity vẫn giữ đường dẫn gốc.
- 16/16 policy/rollback/recover tests Linux và 24/24 gate/CI selector tests Node
  đã pass; actionlint pass
  cho cả 4 workflows. Tests đầy đủ của commit mới sẽ chạy sau push.
- Snapshot CD coherent đã mã hóa, copy ngoài VPS và giải mã/checksum đạt cả
  5 thành phần. Private recovery key ở ngoài repo, ACL owner/System.
- Restore snapshot PostgreSQL vào container cô lập đạt: 40 sự kiện, 8 migration,
  toàn bộ số lượng dữ liệu và fingerprint event/proof khớp bản gốc.

## GitHub deployment

Pending: scoped commit/push, 3 CI của đúng SHA, publish GHCR, controller delivery,
canary, Actions encrypted artifact, rollback/redeploy và chaincode upgrade.
Không coi các kiểm tra base là bằng chứng CI/CD của commit mới.
