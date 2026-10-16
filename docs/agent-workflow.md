# Claude Code và Codex trong AgriTrace

`AGENTS.md` là quy tắc chung; `CLAUDE.md` import nó và chỉ bổ sung cách dùng Claude.
Skill nguồn nằm trong `.agents/skills`, bản Claude được sinh ở `.claude/skills` và
commit cùng nguồn. Cấu hình/reviewer theo client ở `.codex` và `.claude`.
Không coi file cấu hình hợp lệ là bằng chứng client đã nạp hướng dẫn.

## Ngữ cảnh theo công việc

Khi bắt đầu task đổi hành vi, đọc [README](../README.md) và
[PROJECT_CONTEXT](PROJECT_CONTEXT.md), rồi chọn workflow theo trigger trong
[AGENTS](../AGENTS.md). Sửa typo chỉ cần ngữ cảnh liên quan. Task nhiều vùng kết
hợp các skill cần thiết; không import toàn bộ docs vào prompt thường trực.

| Workflow | Nguồn chung |
| --- | --- |
| API contract/DTO/Swagger/generated types | [agritrace-api-contract](../.agents/skills/agritrace-api-contract/SKILL.md) |
| Schema/migration/SQL guard | [agritrace-database-change](../.agents/skills/agritrace-database-change/SKILL.md) |
| Authorization/quantity/custody/sensor/trace/binding/signature/Worker/recovery | [agritrace-hybrid-integrity](../.agents/skills/agritrace-hybrid-integrity/SKILL.md) |
| UI/frontend auth/QR/PWA/signer | [agritrace-frontend-change](../.agents/skills/agritrace-frontend-change/SKILL.md) |
| Chuẩn bị/review release/controller/CI/CD/restore | [agritrace-production-release](../.agents/skills/agritrace-production-release/SKILL.md) |

Source/schema/Swagger mô tả implementation; Issue AGT/plan đã duyệt mô tả mục tiêu;
evidence đúng SHA/môi trường/controller mô tả nghiệm thu. Archive là lịch sử.
Khi khác nhau, ghi rõ gap; không tự sửa lịch sử hoặc đóng acceptance để đồng bộ docs.
Kiểm Git branch/worktree/SHA thực tế. Quyết định/ủy quyền đã có giữ đúng phạm vi,
không suy ra một yêu cầu chuẩn bị release cho phép deploy.

## Codex

Gọi `$agritrace-api-contract` hoặc chọn qua `/skills`; tương tự cho bốn skill còn
lại. Codex tìm `.agents/skills` từ cwd lên repo root. Dùng nguồn chung nếu client
không discovery được; nói rõ khi phải đọc thủ công.

`.codex/config.toml` v1 chỉ có comment để kế thừa toàn bộ session defaults.
Custom agent là `.codex/agents/agritrace-reviewer.toml`, có `name`, `description`,
`developer_instructions`; không đặt sandbox/approval/provider/MCP trong role.
Không tạo `.rules` rỗng: native command rules khác với business rules trong docs.
Chỉ thêm khi có nhu cầu thực thi cụ thể đã được review.

Trong phiên mới, dùng `codex debug prompt-input` để kiểm prompt input tại root và
workspace con. Output có thể chứa hướng dẫn cá nhân, nên chỉ giữ phần tên/path
project đã lọc trong evidence. `codex exec --strict-config` hỗ trợ kiểm config;
flag này không được bản CLI đã kiểm chứng chấp nhận cho `codex debug`.
Nếu project chưa trusted, config layer có thể bị bỏ qua; ghi rõ
limitation, không sửa user/global trust để làm test pass.

## Claude Code

Gọi `/agritrace-api-contract` hoặc xem `/skills`. `CLAUDE.md` bắt đầu bằng
`@AGENTS.md`, tránh duy trì hai bộ quy tắc nghiệp vụ. Bản sinh có cùng tên, độ sâu
thư mục và nội dung với nguồn nên các link tương đối tiếp tục hợp lệ.

`.claude/settings.json` v1 chỉ khai báo schema. Model, permissions và MCP kế thừa
phiên; `settings.local.json`, launch config, worktree và memory cá nhân không
commit. Chưa có hook, skill riêng hoặc cấu hình global được repo thay đổi.

Trong phiên mới, xem `/memory` hoặc `/context` để xác nhận import và `/skills` để
xác nhận tên/path project. Kiểm trùng tên với personal/plugin skills; personal
skill có thể che project skill. Với policy không nạp project instructions hoặc
skills, ghi limitation; không đổi policy cá nhân/managed để ép kết quả.

## Đồng bộ và kiểm tra

Yêu cầu Node/npm theo [README](../README.md), Python 3.11+ và Git trong PATH.
Checker dùng standard-library `tomllib`; nếu cần chọn Python riêng, đặt
`AGENT_SETUP_PYTHON` thành executable. Không cần thêm npm/Python package.

```bash
npm run agents:sync
npm run agents:check
npm run test:agents
```

Các CLI Node xác định root từ script và chạy được từ workspace con. Khi dùng npm
ở workspace con, gọi root script qua `npm --prefix ../.. run agents:check`.
Sync chỉ nhận `--check` tùy chọn qua `npm run agents:sync -- --check`.

Chỉ sửa nguồn chung. Frontmatter v1 gồm đúng `name`/`description`, mỗi giá trị là
plain scalar trên một dòng; tên khớp thư mục, tiền tố `agritrace-`. Không đặt
model, tool grants, hook, dynamic injection hoặc interpolation riêng của client.
Nguồn v1 chỉ cần `SKILL.md`; thêm resources khi workflow cần, không tạo placeholder.

Manifest `.claude/skills/.generated-skills.json` ghi file/checksum do sync quản lý,
không ghi thời gian/đường dẫn máy. Source và manifest là nội dung review trong PR.
Sync preflight trước khi ghi, cập nhật manifest cuối cùng. Một checkout chỉ có
một writer. Nếu bị gián đoạn, chạy lại với cùng source; file khớp bản cũ hoặc
nguồn hiện tại được tiếp tục. Root-level `.agritrace-sync-*.tmp` còn lại là output
local bị ignore, không phải skill và không được tự dọn bằng wildcard.
Đổi resource giữa file/thư mục hoặc đổi tên chỉ khác hoa/thường được sync xử lý
từ manifest cũ; thư mục local ngoài quản lý cản trở chuyển đổi sẽ làm preflight dừng.

Nếu có conflict, giữ file và đối chiếu thủ công. Chuyển thay đổi có chủ đích về
nguồn chung, rồi phục hồi bản sinh từ Git hoặc đối chiếu nó thành đúng bản cũ/nguồn
trước khi sync. Không có `--force`; sync không xóa skill riêng ngoài manifest.
Khi thêm skill chung mới, thêm đúng allowlist của bản sinh vào `.gitignore`.

`agents:check` không ghi file. Nó kiểm metadata, link file, TOML/JSON, độ khớp và
Git ignore trong vùng quản lý; không quét evidence/worktree/snapshot. Kiểm link
xác nhận file tồn tại, không xác nhận mọi câu trong tài liệu còn đúng nghiệp vụ.
Application CI chạy check/tests trong job changes luôn chạy; lỗi chặn Application
gate. Root `npm run check` cũng chạy chúng trước bộ kiểm tra hiện có.

## Review

Hai reviewer chỉ là adapter tới tiêu chí này; không duy trì hai bản rubric.
Khi được yêu cầu review độc lập, main agent cung cấp mục tiêu/acceptance, repo
root, diff hoặc base/head SHA và bằng chứng test đã có. Reviewer đọc `AGENTS.md`,
source hiện tại và tài liệu theo phạm vi; không chỉ dựa vào tóm tắt của main agent.

- Chỉ đọc/review; không sửa file, generate, migrate, retry command, SSH, publish
  hoặc deploy. Hướng dẫn này không tạo sandbox riêng; permissions vẫn kế thừa parent.
- Ưu tiên lỗi correctness, authorization/scope, atomic journal/domain/trace/outbox,
  immutable history, privacy, compatibility và test gap có hệ quả cụ thể.
- Trả findings theo mức độ, file/dòng đã kiểm chứng, điều kiện tái hiện và hệ quả.
  Tách lỗi đã chứng minh khỏi phần chưa xác minh; không tạo finding để đủ số lượng
  hoặc báo lỗi thuần style. Nếu không có finding, nói rõ và nêu giới hạn review.
- Không tự cấp quyền Admin/Auditor để vượt test hoặc coi CI/mock là acceptance.

Chọn `agritrace-reviewer` khi client hỗ trợ named role. Nếu tool surface không có
chọn role, đọc adapter và truyền instructions cùng rubric cho agent thường;
ghi rõ fallback. Nếu delegation bị tắt, main agent tự review theo rubric và nêu
không có independent reviewer; không bật nó trong user config.

## Nghiệm thu bộ agent

Mở phiên mới tại root và `apps/api` cho mỗi client. Kiểm instructions import,
đủ năm tên/path skill, active config/trust và named reviewer hoặc fallback thực.
Không đổi model/permissions/MCP/global config để ép pass. Với reviewer, cấp input
cụ thể và chỉ yêu cầu phân tích, không dùng một task ghi thật để thử quyền.

Chạy sáu tình huống chỉ phân tích/lập kế hoạch, cấm sửa file hoặc gọi production:
đổi DTO; thêm migration; command mất response; sửa landing; đánh giá release;
sửa typo. Mong đợi lần lượt API; database; Hybrid; frontend; release; ngữ cảnh nhỏ.
Task giao nhiều vùng được kết hợp skill; metadata/schema pass không thay behavior
smoke. Giữ evidence đã lọc gắn SHA/client version tại PR hoặc artifact local.
Nếu auth/provider/policy/client ngăn smoke, ghi đúng hạn chế và chưa kết luận
runtime đã nghiệm thu. Không cài hoặc nâng CLI/global runtime tự động.

Khi hai công cụ cùng sửa code, dùng checkout/worktree riêng và phạm vi file rõ.
Không commit local state. Các thay đổi package/workflow/Docker ignore vẫn thuộc
đường Production CD hiện tại; guide/skill không tự cho phép merge/deploy.

Tham khảo: [Codex Skills](https://learn.chatgpt.com/docs/build-skills),
[Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Claude Skills](https://code.claude.com/docs/en/skills),
[Claude Memory](https://code.claude.com/docs/en/memory).
