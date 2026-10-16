@AGENTS.md

## Claude Code

Dùng các skill `/agritrace-*` trong `.claude/skills`, được sinh từ `.agents/skills`.
Chỉ sửa nguồn chung rồi chạy `npm run agents:sync`. Khi cần review độc lập, chọn
`agritrace-reviewer` và cung cấp diff/base/head SHA. Xem
[guide agent](docs/agent-workflow.md) để kiểm tra discovery và fallback.

Model, permissions, MCP và các thiết lập cá nhân kế thừa từ phiên hiện hành.
Không dùng cú pháp riêng của Claude trong skill nguồn chung; không tự import toàn
bộ docs, bật hook hoặc ghi memory chung của repo.
