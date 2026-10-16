# Quy ước đặt tên nhánh Git

Áp dụng từ ngày 11/10/2026 cho repository Agri Trace Blockchain.

## Nhánh nền và nhánh công việc

`main` là nhánh mặc định được bảo vệ và là nhánh nguồn cho CI/CD hiện tại.
`dev` được giữ làm nhánh tích hợp hiện có.

Nhánh công việc dùng `<loại>/<mô-tả-kebab-case>`; dùng chữ thường, chữ số
và dấu gạch ngang. Khi có mã công việc, đặt mã ở đầu phần mô tả, ví dụ
`fix/agt-006-auth-refresh-sessions`. Đặt tên theo mục đích công việc; không
dùng tên công cụ (`codex/`), tên cá nhân hoặc số PR làm tiền tố nhánh mới.

| Loại | Mục đích |
| --- | --- |
| `feature/` | Chức năng hoặc khả năng mới. |
| `fix/` | Sửa lỗi hoặc khắc phục rủi ro đã xác định. |
| `refactor/` | Cải thiện cấu trúc hoặc cách tổ chức code. |
| `ci/` | Workflow, chất lượng, build và cơ chế CI/CD. |
| `docs/` | Tài liệu, runbook và bằng chứng kiểm chứng. |
| `chore/` | Bảo trì và cấu hình vận hành. |
| `integration/` | Các nhánh tổng hợp của thành viên được giữ từ lịch sử repo. |

Dùng nhánh công việc và PR cho thay đổi mới. Không đổi tên `main`/`dev` hoặc
thay đổi ruleset chỉ để thực hiện quy ước này. Các nhánh `integration/`
giữ nguyên nội dung của nhánh thành viên cũ, không thay thế quy trình PR.

## Đổi tên trên GitHub ngày 11/10/2026

36 nhánh được đổi tên bằng GitHub Rename Branch API. Tổng số nhánh trên
GitHub vẫn là 45; toàn bộ 23 nhánh `codex/...` đã được đổi tên. 9 nhánh
đã phù hợp quy ước được giữ tên cũ, gồm `main`, `dev`, 5 nhánh `ci/contabo-*`,
`docs/add-refactoring-verification` và
`feature/modular-monolith-dedicated-worker`.

Đối chiếu sau thao tác xác nhận SHA của cả 45 nhánh, trạng thái bảo vệ của
từng nhánh, nhánh mặc định `main`, ruleset Protect main và trạng thái/giờ
merge của các PR giữ nguyên. Không có PR mở trước khi đổi tên. Không chạy
build/test ứng dụng vì thao tác chỉ đổi metadata Git, không đổi source code.

Tên và upstream của các nhánh local tương ứng trên máy thực hiện đã được
đồng bộ; SHA local được bảo toàn kể cả khi khác SHA remote. Nhánh chỉ tồn tại
local không nằm trong phạm vi đổi tên trên GitHub. Các thay đổi có sẵn trong
working tree được giữ nguyên.

| Tên cũ | Tên mới | PR liên quan |
| --- | --- | --- |
| `codex/agritrace-cutover` | `chore/agritrace-cutover` | [#76](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/76) |
| `codex/agritrace-domain-alias` | `chore/agritrace-domain-alias` | [#74](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/74) |
| `codex/agt-002-remediation` | `fix/agt-002-dependency-remediation` | [#50](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/50) |
| `codex/auth-password-byte-limit` | `fix/auth-password-byte-limit` | [#82](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/82) |
| `codex/ci-clean-code-safe-merge-20261009` | `ci/clean-code-quality-gates` | [#70](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/70) |
| `codex/ci-dependency-graph-timeout` | `ci/dependency-graph-timeout` | [#69](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/69) |
| `codex/ci-plan-b` | `ci/quality-gates-fabric` | [#47](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/47) |
| `codex/core-completion` | `feature/core-completion` | [#75](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/75) |
| `codex/deploy-audit` | `fix/deploy-recovery-auth-contracts` | [#77](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/77) |
| `codex/deploy-safety-followup` | `fix/deploy-recovery-writer-safety` | [#78](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/78) |
| `codex/fix-shipment-telemetry-response` | `fix/shipment-telemetry-response` | [#73](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/73) |
| `codex/frontend-mobile-overhaul` | `feature/frontend-mobile-overhaul` | [#83](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/83) |
| `codex/harvest-retry-recovery` | `fix/harvest-retry-recovery` | [#81](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/81) |
| `codex/main-integration-audit` | `fix/main-integration-audit` | [#12](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/12) |
| `codex/nongtrace-dashboard-role-links` | `fix/nongtrace-dashboard-role-links` | [#67](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/67) |
| `codex/nongtrace-domain-https` | `ci/nongtrace-domain-https` | [#63](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/63) |
| `codex/nongtrace-uat-audit-evidence` | `docs/nongtrace-uat-audit-evidence` | [#68](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/68) |
| `codex/nongtrace-uat-clean-audit` | `fix/nongtrace-uat-clean-audit` | [#66](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/66) |
| `codex/nongtrace-uat-report` | `docs/nongtrace-uat-report` | [#65](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/65) |
| `codex/nongtrace-uat-verification` | `fix/nongtrace-public-trace-mobile-titles` | [#64](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/64) |
| `codex/selective-cleanup` | `fix/gateway-public-trace-cleanup` | [#72](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/72) |
| `codex/uat-core-cutover` | `fix/uat-core-cutover` | [#79](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/79) |
| `codex/uat-core-deployment-record` | `docs/uat-core-deployment-record` | [#80](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/80) |
| `phat` | `integration/phat` | — |
| `phi` | `integration/phi` | — |
| `phi2` | `integration/phi-v2` | — |
| `phi-agt-008` | `feature/agt-008-masterdata-administration` | — |
| `phi-agt-010` | `feature/agt-010-generated-openapi` | — |
| `phi-ui-optimization` | `refactor/ui-optimization` | — |
| `project-structure-refactor` | `refactor/project-structure` | — |
| `risk-hardening` | `fix/risk-hardening` | [#10](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/10) |
| `tuan` | `integration/tuan` | — |
| `tuan-AGT002-dependency-advisories` | `fix/agt-002-dependency-advisories` | [#51](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/51) |
| `tuan-BE-02-traceability-api` | `feature/be-02-traceability-api` | — |
| `tuan-BE-03-media-management` | `feature/be-03-media-management` | [#48](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/48) |
| `tuan-fix-auth-cookie` | `fix/agt-006-auth-refresh-sessions` | [#71](https://github.com/KieuTanPhat/agri-trace-blockchain/pull/71) |

## Cập nhật các clone khác

Tra tên mới trong bảng trên. Trong clone của từng thành viên, chạy:

```bash
git branch -m OLD-BRANCH-NAME NEW-BRANCH-NAME
git fetch origin --prune
git branch --set-upstream-to=origin/NEW-BRANCH-NAME NEW-BRANCH-NAME
```

Bỏ qua lệnh đổi tên local nếu chưa có nhánh cũ trong clone. Các lệnh trên
không reset hoặc thay thế commit local. Nếu có worktree dùng nhánh cũ,
kiểm tra `git worktree list` sau khi đổi tên.

GitHub không chuyển hướng lệnh Git dùng tên cũ hoặc URL raw theo tên cũ.
Với repo này, workflow CI/CD đã được kiểm tra chỉ lọc `main`; không có
tham chiếu nhánh đổi tên trong workflow hoặc scripts vận hành được kiểm tra.
Giữ tên nhánh trong các báo cáo lịch sử để phản ánh đúng thời điểm ghi nhận;
dùng bảng trên để tra tên hiện hành.

Tham khảo: [GitHub: Renaming a branch](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/renaming-a-branch)
và [GitHub Rename Branch API](https://docs.github.com/en/rest/branches/branches#rename-a-branch).

