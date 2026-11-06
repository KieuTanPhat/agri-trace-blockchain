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

Lịch sử đổi tên nhánh ngày 11/10/2026 và bảng mapping có trong Git. Khi cần dùng
lại nhánh cũ, kiểm branch/upstream/SHA thực tế; không suy ra trạng thái remote từ
bảng lịch sử. Đồng bộ hoặc push chỉ trong phạm vi tác vụ được giao.
