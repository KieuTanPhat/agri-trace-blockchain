@AGENTS.md

## Claude Code

Nếu `AGENTS.md` chưa được nạp vào context, đọc file `AGENTS.md` nằm cạnh
`CLAUDE.md` này trước khi phân tích hoặc sửa đổi. Khi mở phiên từ workspace con,
Claude có thể bỏ qua import nằm ngoài cwd; không suy ra rằng dòng `@AGENTS.md`
đã được mở rộng và không đổi trust/global config để bỏ qua hạn chế đó.

Dùng các skill `/agritrace-*` trong `.claude/skills`, được sinh từ `.agents/skills`.
Chỉ sửa nguồn chung rồi chạy `npm run agents:sync`. Khi cần review độc lập, chọn
`agritrace-reviewer` và cung cấp diff/base/head SHA. Xem
[guide agent](docs/agent-workflow.md) để kiểm tra discovery và fallback.

Model, permissions, MCP và các thiết lập cá nhân kế thừa từ phiên hiện hành.
Không dùng cú pháp riêng của Claude trong skill nguồn chung; không tự import toàn
bộ docs, bật hook hoặc ghi memory chung của repo.
