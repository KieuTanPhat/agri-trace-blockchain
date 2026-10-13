# Hybrid handover — 13/10/2026

DỪNG theo chỉ đạo người dùng; không tự tiếp tục, deploy, push main hoặc shutdown máy.
Worktree: `C:\Users\kieup\.codex\worktrees\hybrid-chain-owner\agri-trace-blockchain`.
Branch: `feature/hybrid-chain-business-scope`. Không sửa/reset/stage/switch Desktop/main.
Nguồn cuối đã push: `85b50cfe30473553592e7c62354502eb38a00317` (WIP verifier).
Checkpoint đã kiểm DB: `b3d37080f750ba8f5d063ee1669e46f60221c54f`.
Commit mang file này là tip bàn giao cuối, push fast-forward; SHA được in trong trả lời cuối.
Tra SHA đó bằng `git log -1 --format=%H -- docs/hybrid-handover-2026-10-13.md`.

## Remote và production

- Remote main: `a450ca2e031fb36917ebf0e43867d8deae40c144`; dev: `6be14c2b6efb1c706454c9619609d44a5ae5f608`.
- Production đã kiểm gần nhất: `prod-8ae13542aee92b47d7ed64a0d83d560dbb517dc3`, agritrace.dev, channel agritrace/sequence3.
- Production giữ 15 migrations; floor Hybrid 16/17 chỉ áp DB cách ly. CD checksum allowlist chưa nhận hai migration mới.
- Dev/nongtrace deployment/CD đã retire; không resume/provision/monitor dev. Tên volume/project UAT cũ giữ để bảo toàn PGDATA.
- Receipt production UTC02:22:58 ngày13/10: 60 ledger/Pending0, QR2+6, 118 old fingerprints/current120, 209 identities unchanged.
- Observation elapsed8,653h/gap3207,353s, complete=false; không suy healthy trong gap. Không truy cập VPS khi dừng bàn giao.

## Source và nghiệm thu A/B/C

| Phần | Đã xong, SHA và lệnh đạt | Đang dở / chưa bắt đầu |
| --- | --- | --- |
| A | `b3d37080`: 17 official migrations; zero diff/6 guards; 147 API unit/31 SQL/ORM/132 policy-DB(26 HTTP)/112 E2E; `python .codex/ops/hybrid-local-policy.py start` PASS. Restore56 tables/2421 rows/1028 guards +2 mutation refusals PASS. | Browser trên b3 failed; scoped verifier WIP; actual tracked CI restore/container/Fabric, old production writer/restricted copy, compatible app rollback, main CI/checksum/cutover/rollout còn mở. |
| A delivery | `b3d37080`: Linux `python3 -m unittest discover -s deploy/cd -p 'test_*.py'` 119 PASS; Node CD/config38 PASS; pin validator2, CI21, cast canonicalizer21, fixture14, restore runner46 pure tests PASS; 4 workflows actionlint PASS. | External IO forward tests dùng stubs; CMS encrypt/decrypt/checksum/pin restore dùng real IO. Chưa nghiệm thu forward/image rollback trên runtime thật. |
| A Web | `4db66c6`: 207 unit/DOM +84 lint-contract +4 optimizer/lint/type/build; `5bc74773cbadc845ea53485e6f8977a123844baf`: `python .codex/ops/hybrid-browser-local.py` 7 groups PASS. | Chromium/iPhone13 viewport+touch, chưa real Safari/iOS. Không chuyển pass5bc thành passb3. |
| B | `b3d37080`: plan binding/protocol/router/permissions/barriers/rotation/join/restore, 5 design vectors đối chiếu encoders. | B implementation/migrations/actual Fabric acceptance chưa bắt đầu; A route sidecar không là B binding router. |
| C | `b3d37080`: plan versioned commitment/key authority/intents/effect root/dual handover/UI, synthetic golden signature checked. | C implementation/migrations/readers/UI/Fabric acceptance chưa bắt đầu; enterprise authority NotEvaluated. |

Phân loại source khi dừng: (a) nhóm hoàn thiện đã commit `b3d37080` (32 files); (b) `deploy/cd/verify.mjs` riêng tại `85b50cf`, message `wip: ...needs controller receipt wiring and VM tests`; (c) giữ nguyên 2 docs dirty và AGENTS.md untracked, không stage.
WIP chỉ đạt `node --check deploy/cd/verify.mjs`; chưa chạy acceptance, chưa wiring config/controller/canary receipt/tests. Không cài WIP helper vào production.

## Gate A mở: lỗi và bước kế tiếp khi được tiếp tục

| Gate | Trạng thái / bước kế tiếp |
| --- | --- |
| Restore/CHECK | Hai ae runs failed vì 5 CHECK cast-array deparser forms; mọi rows bằng nhau. Canonicalizer chỉ đúng 5 names/columns/ordered domains/two full forms; giữ flags/guards/indexes. b3 local restore PASS, không sửa SQL để xanh. Chạy tracked CI restore thật và restricted production-copy rehearsal tiếp. |
| First cutover/forward | Admission SHA riêng, snapshot pin bytes/checksums, quiescent baseline, full floor, immutable catalog/metadata, late env/Fabric/CI rechecks, journal/fsync đã code/unit-pass. Cần runtime crash/partial16/17/retry/compatible-image rollback rehearsal; không dùng image8ae rollback qua floor. |
| Scoped verifier | WIP optional scopeVerification/canaryRequest, actor coverage/current authority, original key/body/inspect/replay, throttle pacing. Thiếu trusted config validation + Controller payload + exclusive0600/fsync request receipt + VM/real API tests; review static/dynamic imports và old8ae compatibility. |
| CI exact SHA | b3 đã push feature, API lookup lúc bàn giao trả runs=[]; chưa dispatch. Main chỉ chấp nhận 3 exact-main push successes, không dùng feature dispatch/skip/cancel/old pass. CI restore/container/UAT/Fabric có thể còn harness lỗi, chưa gọi là pass. |
| Checksum | Hai official scripts: scope `a7ddb508e19a9179887a3bcc4fb233e0999af689ab6c962488579f8db9e6bbee`; route `1066a02962d2f67724e49646c94edfe3d3f564655e89f94886e55560beaf36ed`. Chỉ thêm REVIEWED_EXPANSIONS sau dependencies/rehearsal/review; arbitrary SQL parser giữ restrictive. |
| Rollout | Chưa push Hybrid main/deploy. Cần old-writer/copy/restore/compatible app, scope verifier/current canary principals, independent pins/import readiness, backup/CI/canary/rollback/24h samples thực. WIP không là release. |

## Failure và receipts giữ nguyên

`L=.codex/evidence/hybrid-local/` dưới worktree; không xóa/ghi đè các lượt cũ.

| Failure | SHA / receipt | Phân loại và việc còn thiếu |
| --- | --- | --- |
| `backup-restore: assert after==before` | `ae557d59dbd0ee96066ebea5efac5e12dd5a4e67`; `L/agritrace-hybrid-local-ae557d59-1791857900449886500` và `...-1791858668316002400` | Harness textual CHECK comparison; no OOM/restart. Đã sửa bằng narrow canonicalizer; b3 PASS. Failures vẫn lưu. |
| `locator.selectOption` timeout tại `scripts/ci/hybrid-browser-check.mjs:232` | b3; `L/agritrace-hybrid-local-browser-b3d37080-1791861582602650400` | Harness/session triage còn mở: sau reload về login, thiếu combobox “Chọn chuỗi”; chỉ group desktop lost-response đã đạt. Không thấy429 trong diagnostics; chưa đủ kết luận source/resource. Đọc browser-check.log/diagnostics/failure.png và auth/session events trước sửa. |
| Verifier acceptance chưa chạy | `85b50cf`; `deploy/cd/verify.mjs`, scoped-verification plan | Source WIP/integration chưa xong, không giả lập thành test pass/fail. Thiếu controller/tests và real API gate. |

b3 DB PASS receipt: `L/agritrace-hybrid-local-b3d37080-1791861001046323500`; result.json/restore-result.json/status.json/cleanup.json.
5bc browser PASS: `L/agritrace-hybrid-local-browser-5bc74773-1791855493931239000`; trước b3, không chung SHA.
b3 browser fresh preparation/read-only route readiness PASS nhưng suite overall FAILED; cleanup cả process/container/network/port/keeper=true.
Legacy fixture/harness failures và production gaps khác đã ghi trong các plan/evidence lịch sử; không xóa khi chạy lại.

## Chạy lại cục bộ — chỉ agent được giao tiếp tục

Đọc helper trước dùng; kiểm pointer/status/terminal/locks/source SHA trước start. Không chạy DB/browser trùng nhau hoặc sửa source fence khi job running.
Bundled Node24.19/Python; npm12.1.0 ở `.codex/tooling/npm12`; npm11 gây false invalid dependency graph, không đổi lock/assertions để né.

```powershell
Set-Location 'C:\Users\kieup\.codex\worktrees\hybrid-chain-owner\agri-trace-blockchain'
$node = 'C:\Users\kieup\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$py = 'C:\Users\kieup\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:PYTHONIOENCODING='utf-8'
$env:PATH="$PWD\.codex\tooling\npm12\node_modules\.bin;$(Split-Path $node);$env:PATH"
& $py .codex/ops/hybrid-local-policy.py status
& $py .codex/ops/hybrid-local-policy.py start
# Chỉ sau DB terminal + cleanup verified, browser pointer không running:
& $py .codex/ops/hybrid-browser-local.py
wsl -d Ubuntu --cd /mnt/c/Users/kieup/.codex/worktrees/hybrid-chain-owner/agri-trace-blockchain -- python3 -m unittest discover -s deploy/cd -p 'test_*.py'
& $node --test scripts/ci/ci.test.mjs scripts/ci/hybrid-restore-guards.test.mjs deploy/hybrid-restore-run.test.mjs deploy/hybrid-route-fixture.test.mjs deploy/hybrid-pins.test.mjs
wsl -d Ubuntu --cd /mnt/c/Users/kieup/.codex/worktrees/hybrid-chain-owner/agri-trace-blockchain -- .codex/tooling/node-v22.22.3-linux-x64/bin/node --experimental-vm-modules --test deploy/cd/gate.test.mjs deploy/cd/publish.test.mjs deploy/cd/send.test.mjs deploy/cd/session-auth.test.mjs deploy/cd/verify.test.mjs deploy/config.test.mjs
```

Helpers tự cấp synthetic env: NODE_ENV=test, FABRIC_ENABLED=false, HYBRID_DRAFT_TESTS/HYBRID_CI_TESTS=1, SHA/control/TEST_DATABASE_URL/DATABASE_URL riêng; không lấy credentials production.
WSL Ubuntu Docker29 Linux; PG18 image pinned `postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`, 384MiB/1CPU/tmpfs256MiB/labels, loopback25488 hoặc25489.
Giữ PostgreSQL16 main5432 của người dùng; Docker Desktop engine chưa ready, không reset context/DB/WSL để ép test.
Browser cần Playwright1.62.1 + matching Chromium (`& $node node_modules/playwright/cli.js install chromium` nếu thiếu), real same-origin Next build, Nest API/PG18.
Build Web: `$env:NEXT_PUBLIC_API_SAME_ORIGIN='true'; $env:NEXT_PUBLIC_MOCK_API='false'; & $node .codex/tooling/npm12/node_modules/npm/bin/npm-cli.js run build --workspace apps/web`.
Tracked CI-only runners yêu cầu GITHUB_ACTIONS/SHA/run/workspace/service IDs/scope/evidence đúng; không giả CI env để chạy trên VPS. Local Python restore chưa thay real tracked CI proof.

## Bản đồ Markdown Hybrid hiện có

Paths sau dưới `docs/`; “hiện hành” là nguồn hướng dẫn, không có nghĩa đã nghiệm thu. Evidence luôn pin SHA.

| File | Vai trò |
| --- | --- |
| `plans/hybrid-fabric-chain-owner-plan-2026-10-11.md` | Hiện hành: A→B→C/acceptance; dev steps cũ đã bị production-only thay thế. |
| `plans/hybrid-migration-and-release-2026-10-13.md` | Hiện hành: migration/release/ownership/recovery, chứa checkpoint lịch sử. |
| `plans/hybrid-a-completion-2026-10-13.md` | Hiện hành: A dependency checklist + lịch sử failures/evidence. |
| `plans/hybrid-ledger-route-import-2026-10-13.md` | Hiện hành: route/import/provenance; giữ dated evidence. |
| `plans/hybrid-scoped-production-verification-2026-10-13.md` | Hiện hành: verifier target và contract WIP. |
| `plans/hybrid-b-binding-and-permission-2026-10-13.md` | Hiện hành: thiết kế B, chưa implementation. |
| `plans/hybrid-c-commitments-and-signatures-2026-10-13.md` | Hiện hành: thiết kế C, chưa implementation. |
| `adr-002-hybrid-business-scope.md`, `adr-003-hybrid-historical-ledger-route.md` | Hiện hành: quyết định scope/route/compatibility. |
| `hybrid-migration-review-2026-10-13.md`, `hybrid-legacy-scope-rehearsal.md` | Hiện hành: official catalog/rehearsal; không production approval. |
| `hybrid-legacy-scope-implementation-2026-10-12.md`, `hybrid-business-activation-2026-10-12.md` | Hiện hành: implementation/guards, dated evidence. |
| `hybrid-schema-alignment-2026-10-12.md` | Hiện hành: alignment/unique guard rationale; historical counts không thay b3. |
| `plans/hybrid-recovery-and-completion-plan-2026-10-12.md`, `plans/hybrid-targeted-audit-2026-10-12.md` | Lịch sử kế hoạch refactor/audit; các gate chưa xong vẫn phải đọc cùng plan ngày13. |
| `hybrid-cloud-validation-2026-10-12.md` | Chỉ evidence cloud lịch sử, không latest SHA/production acceptance. |
| `hybrid-chain-management-implementation.md`, `hybrid-progress-2026-10-12.md` | Dirty có sẵn của người dùng: không stage/sửa; không dùng làm latest receipt. |
| `hybrid-handover-2026-10-13.md` | Checkpoint dừng hiện hành này. |

Đọc thêm production-runbook/production-only transition/deployment receipts; dev observation cũ đóng false do retirement.

## Quyết định/nguyên tắc bàn giao

- Chờ chỉ đạo tiếp tục từ người dùng/agent mới; không xin lại quyền triển khai đã giao nhưng STOP hiện tại ưu tiên.
- Enterprise partner governance/CA/peer/admin/signer thực chưa có; mapping và reviewed scoped canary/proofCoverage cần dữ liệu/authority thật, không tự tuyên bố được xác nhận.
- Không execute Prisma diff, sửa applied migration/hash/proof/journal/outbox/ledger/identity hoặc auto-import theo env để vượt gate.
- Không start image8ae sau scope/route floor; generic compatible_migrations không waives floor. Không auto restore production DB/ledger khi rollback.
- Unknown/expired PROCESSING giữ hold/original key, không execute lại/đổi key. Không nới throttle hoặc coi technical Fabric là enterprise authority.
- Không amend/rebase/force commit đã push, không xóa evidence, không resume dev, không dọn Docker/WSL/PG16 toàn hệ thống.
- Khi dừng: 3 subagents không chạy; DB/browser đã terminal; labeled test containers/networks=[], ports25488/25489/25600/25601/25602 released, keepers/processes gone; PG16 main5432 vẫn online.
- Automation cũ đã bị xóa trước checkpoint; không tạo lại. Shutdown chỉ khi toàn nhiệm vụ thực sự hoàn tất; điều kiện đó chưa đạt.
