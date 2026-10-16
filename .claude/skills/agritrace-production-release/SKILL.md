---
name: agritrace-production-release
description: Chuẩn bị hoặc review release AgriTrace, CI/CD, controller compatibility, rollback/restore và evidence; skill không tự cấp quyền merge, publish hoặc deploy.
---

# Chuẩn bị release AgriTrace

Đọc [hướng dẫn chung](../../../AGENTS.md), [production runbook](../../../docs/production-runbook.md)
và [CI guide](../../../docs/ci.md). Skill này chuẩn bị/đánh giá; plan/review chỉ đọc,
không dispatch workflow, SSH, đổi controller hoặc thực thi release.

1. Xác định candidate SHA, diff, image/manifest/controller revision và acceptance
   từ Issue/plan hiện hành. Đối chiếu [release gates](../../../docs/plans/hybrid-production-readiness-2026-10-13.md)
   và source CLI thực tế. Không lấy tên nhánh, receipt cũ hoặc Issue baseline làm
   bằng chứng runtime hiện tại.
2. Lập danh sách kiểm theo đúng generation đang cài, schema 3, manifest format 2,
   digest/checksum, migration review/floor và recovery/journal. Không trộn controller
   UAT đã retire hoặc lấy pilot local làm lệnh production.
3. Đánh giá ba gate CI đúng candidate, production rehearsal, Fabric thật, isolated
   restore và VPS smoke như runbook yêu cầu. Ghi phần chưa có evidence; không tự
   đánh dấu acceptance từ compile/mock hoặc job bị skip.
4. Đối chiếu backup/restore, writer hold, unknown outcome và compatible rollback.
   Không reset DB, sửa history/hash/journal, restore riêng DB sau ledger commit
   hoặc cleanup tài nguyên không xác định ownership. Không đưa secret vào ví dụ.
5. Nêu tác động CD của diff, đặc biệt package/workflow/Docker ignore vào main.
   Giữ ủy quyền người dùng đã có đúng phạm vi; yêu cầu chuẩn bị release không tự
   mở rộng thành merge/deploy. Khi có tác vụ vận hành được ủy quyền, theo runbook
   và xác minh runtime, không suy ra lệnh chỉ từ skill này.

Trả candidate, evidence matrix, compatibility/recovery và blocker cụ thể. Kết quả
nằm ở PR/Issue hoặc artifact local gắn SHA; không tạo báo cáo Markdown cho mỗi run.
