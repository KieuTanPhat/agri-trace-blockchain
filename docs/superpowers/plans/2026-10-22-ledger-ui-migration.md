# AgriTrace Ledger UI Migration Implementation Plan

Điều chỉnh ngày **23/10/2026** theo yêu cầu người dùng: tăng tốc triển khai, bỏ kiểm thử quá chi tiết và kiểm tra lặp. Bản này thay thế quy trình kiểm thử trong plan cũ; giữ nguyên phạm vi sản phẩm, nguồn UI, nghiệp vụ và các task đã hoàn thành. Không bắt đầu lại migration.

Đọc cùng [design spec](../specs/2026-10-22-ledger-ui-migration-design.md) và [inventory](../specs/2026-10-22-ledger-ui-migration.inventory.json). Inventory quyết định chính xác URL, file đích và nguồn preview; plan quyết định thứ tự, trách nhiệm và kiểm tra cần thiết.

## 1. Trạng thái để tiếp tục

| Mục | Giá trị đã xác nhận |
|---|---|
| Worktree đang dùng | `C:/Users/kieup/.codex/worktrees/ledger-ui-migration/agri-trace-blockchain` |
| Nhánh local | `refactor/ledger-ui-migration` |
| Baseline đã fetch và chốt ở Task 1 | `e1415e91eaaa96aab7b12f9cb972b109296b5720` từ `origin/feature/admin-console-processor` |
| Checkpoint khi sửa plan | `f9ef2c70fae268321a7857cac185bc1a8d9c9eda`; phải kiểm tra lại Git khi tiếp tục |
| Ledger local | `.superpowers/sdd/2026-10-22-ledger-ui-migration/progress.md` |
| Snapshot UI đã chốt | `.superpowers/sdd/2026-10-22-ledger-ui-migration/preview` |
| Provenance | 127 file preview; manifest SHA256 `2f9c86d84a4ccf58b7f315ce3a6f48775b9cc007bf779652cd91d7ef970512d2` |
| Phạm vi chức năng | 143 canonical page route; 803 nghĩa vụ view/action đã trích, bổ sung nếu phát hiện thiếu |
| Đã xong | Tasks 1–6; Task 6 tại `c4b8833a1f459e536555ad9779a045f2e69ea8ca` |
| Đang làm | Task 7: 3 route cases tại `c2b28d7` và 2 route privacy tại `f9ef2c7` đã commit; còn 5 route support/reports/recall/notices |

Trước khi sửa code, đối chiếu `git status`, HEAD và dòng mới nhất của ledger. Tiếp tục phần chưa xong, giữ thay đổi đang làm; không reset/rebase, tạo worktree thứ hai, fetch lại để đổi baseline, đóng lại snapshot hoặc chạy lại Tasks 1–6. Nếu trạng thái mới hơn bảng này thì Git và ledger mới nhất là nguồn sự thật. Không có yêu cầu hoàn thành Task 7 chỉ vì plan đã sửa.

## 2. Global Constraints

- Thay toàn bộ giao diện web bằng UI/UX Ledger của `C:/Users/kieup/Desktop/Fe-clone-Agritrace/agritrace-admin-preview`. Nguồn này chỉ đọc; dùng snapshot và nguồn đã ghi trong inventory, gồm các màn doanh nghiệp bổ sung.
- Tuyệt đối không dùng lại bố cục, DOM trình bày, UI component, CSS, navigation, design token hoặc ảnh tham chiếu của UI cũ; không đổi tên rồi dùng lại, phủ theme hoặc giữ fallback. Renderer nằm trong `src/lib` cũng phải thay.
- Chỉ giữ logic baseline không có giao diện: API/types, auth/session, scope, validation, quantity/custody, command/recovery, QR parsing và signer. Khi logic nằm lẫn JSX cũ, dùng AST trích phần không render; không đọc renderer cũ làm nguồn thiết kế.
- Giữ đủ 143 URL, deep link/query semantics, mọi chức năng, quyền, API và trạng thái lỗi của baseline. Không bỏ filter/export/history/evidence hoặc workflow ít dùng để giảm thời gian.
- Giữ allowedCommands, organization scope, optimistic version, idempotency, exact request body/key/signature và recovery. Admin/Auditor không được cấp thêm quyền ghi nghiệp vụ.
- Runtime gọi API thật qua client baseline; không nhập mock auth, role engine, endpoint giả hoặc dữ liệu demo từ preview.
- Giữ Next.js **16.4.2**, React/React DOM **19.3.0**, Tailwind **4**, native SWC/Turbopack, async routing và standalone output đã chuyển ở Task 2; Node/npm theo engines của repo.
- Không sửa backend, DB/migration, Worker, chaincode, generated API contract hoặc hạ tầng deploy. Không merge/cherry-pick UI của `feature/enterprise-registration-plans`/`61fcbb3`.
- Native: một implementer tuần tự; chỉ một `agritrace-reviewer` độc lập kiểm tra toàn nhánh ở cuối. Không tạo agent/test/reviewer riêng cho từng task.
- Chỉ commit local đúng phạm vi. Không push, PR, merge, deploy, sửa preview hoặc xóa worktree. Không đọc/in secret; không commit ledger, ảnh/log, snapshot, personal config hoặc scratch.

## 3. Quy trình triển khai nhanh

1. Chỉ đọc nguồn và phần tài liệu cần cho task hiện tại. Có `.codegraph/` thì dùng CodeGraph trước; không tự tạo index. Lấy task references bằng `uiSource.taskReferences.find(entry => entry.task === taskNumber)`, không dùng số task làm chỉ số mảng.
2. Port cả nhóm màn hình liên quan từ preview, ghép API/types/logic baseline và thay toàn bộ route wrapper của nhóm. Tận dụng component Ledger đã port; không dựng một framework form/dashboard tổng quát để che mọi domain.
3. Đối chiếu tất cả actions của nhóm trong matrix với source baseline và implementation mới. Chỉ viết thêm test cho rủi ro thực sự chưa được bảo vệ theo mục 4. Không viết test chỉ để có RED trước khi copy UI.
4. Khi hoàn thành task, chạy typecheck một lần và các test bị ảnh hưởng, kiểm provenance/scope nếu có import/di chuyển file mới. Dùng kết quả vừa đạt cho cùng trạng thái code; không chạy lại chỉ để helper ghi task-done. Nếu helper buộc lặp gate, ghi ledger thủ công với lệnh/kết quả thật.
5. Commit theo task khi đủ chức năng; có thể giữ checkpoint riêng cho nhóm lớn. Ghi ngắn trong ledger: SHA, phần đã xong/còn lại, lệnh đạt, giới hạn. Không tạo báo cáo Markdown cho từng run hoặc commit riêng mỗi test.

Áp dụng các skill repo phù hợp: `agritrace-frontend-change`, thêm hybrid-integrity khi chạm auth/recovery/signer; API-contract chỉ khi cần đối chiếu hợp đồng consumer. Không kéo task UI sang sửa DB/release.

Nếu Superpowers còn khả dụng, dùng `executing-plans`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review` và `finishing-a-development-branch` đúng lúc; `test-driven-development` chỉ áp dụng phạm vi rủi ro ở mục 4. Không tạo lại worktree với `using-git-worktrees`. Quyết định mới của người dùng về giảm test được ưu tiên hơn chu kỳ TDD lặp máy móc trong skill. Nếu skill không có trong client, tiếp tục quy trình tương đương trong plan, ghi rõ thiếu skill; không dừng để cài lại plugin.

Chỉ một heavy job local mỗi lúc. Test/build ghi ra log local; chỉ đọc exit code, tối đa 60 dòng lỗi hoặc 15 dòng tóm tắt. Không chạy broad suite nhiều lần khi không có thay đổi liên quan.

## 4. Chính sách kiểm thử thay thế

### Giữ kiểm thử ở nơi có thể làm sai quyền hoặc dữ liệu

- TDD cho **logic mới hoặc logic bị đổi** về authorization/scope, dữ liệu riêng tư, validation chuyển payload, version/idempotency, kết quả command chưa rõ, chữ ký, quantity/custody và QR điều hướng. Quan sát lỗi đúng nguyên nhân rồi sửa và chạy lại test liên quan. Test hiện có đã bảo vệ đúng nhánh thì tái dùng, không nhân bản ở từng screen.
- Mỗi domain mặc định chọn khoảng **1–3 luồng browser có giá trị**: thao tác chính và lỗi/quyền/recovery đặc thù. Đây là hướng chọn mẫu, không phải quota; chỉ thêm khi có rủi ro khác chưa được kiểm chứng. Nhiều bước trong một workflow có thể kiểm trong cùng scenario.
- Giữ assertions nghiệp vụ hiện có. Có thể sửa selector/render assertion cho UI Ledger; không thêm `skip`, nới quyền, sửa expected kết quả sai hoặc ép kiểu để làm xanh.
- Browser contract fixtures vẫn có type, đúng endpoint/method/body và chặn request ngoài fixture, page/console errors. Fixture chỉ ở test; không coi mock là bằng chứng backend/Fabric thật.

### Bỏ các yêu cầu quá chi tiết của plan cũ

- Không bắt buộc RED→GREEN cho copy layout, CSS, nhãn, bảng đọc, wrapper hoặc từng URL/action không đổi logic. Dùng typecheck, đối chiếu source/provenance và kiểm tra màn đại diện.
- Không bắt buộc một test hay một fixture riêng cho mỗi trong 143 route hoặc 803 actions. Giữ đủ chức năng bằng matrix/source review toàn bộ; browser tập trung workflow và layout khác biệt. Không tạo 143 bài chỉ mở trang rồi tìm heading.
- Không viết test khẳng định màu/class/DOM/copy hoặc test cùng một permission predicate tại mọi trang. Không nhân test recovery chung cho từng domain nếu engine và cách nối không đổi.
- Không chụp ảnh từng route/action hay chạy tích Descartes route × role × 4 viewport × theme × locale. Không port test của mock preview.
- Không chạy lại full Vitest, toàn bộ browser auth/governance, lint toàn web, production build hoặc Docker sau mỗi task/commit. Chỉ chạy subset có dependency bị đổi; tổng thể một lần tại Task 18.
- Không chạy backend/Worker/chaincode/DB suites hoặc toàn bộ `test:hybrid:browser` chỉ vì port UI. Harness live chỉ thêm khi thay đổi đường gọi auth/command/signature/invariant chưa được test hiện có bảo vệ, hoặc phát hiện bất nhất cần đối soát. Thiếu evidence runtime liên quan phải được ghi rõ và giải quyết trước khi nhận phần hành vi đó; không mở rộng sang nghiệm thu production/hardware khi không bị tác động.

### Kiểm tra sau mỗi task

| Loại thay đổi | Kiểm tra cần làm |
|---|---|
| Chỉ port trình bày, wrapper, bảng đọc | Typecheck một lần khi xong task; kiểm UI đại diện và matrix; không tạo unit/browser chỉ cho số lượng |
| Form nối API/DTO hiện có | Một workflow contract cho nhóm form; đối chiếu method/body/version/quyền với baseline, tái dùng unit validation đã có |
| Logic/quyền/recovery/signer mới hoặc bị đổi | TDD test nhánh rủi ro; chạy các test dependency bị ảnh hưởng, thêm browser tại điểm tích hợp nếu unit chưa đủ |
| Sửa shared provider/transport/command dialog | Chạy các test shared và browser consumer bị ảnh hưởng, gồm auth nếu thật sự dùng chung; không tự động chạy mọi domain |
| Tài liệu/locale/format thuần hiển thị | Diff/link/typecheck khi cần; không chạy suite nghiệp vụ |

Lệnh dùng lại từ worktree:

```powershell
npm run typecheck --workspace apps/web
npm test --workspace apps/web -- <affected.spec.ts> --reporter=dot
npm exec --workspace apps/web -- playwright test --config playwright.ledger.config.ts <affected.spec.ts> --project=contract --reporter=dot
```

Root `npx playwright test` không phải CLI phù hợp với dependency layout hiện tại. Kết quả từ Tasks 1–6 vẫn hợp lệ cho code chưa đổi; không xóa các test đã viết để giảm số lượng. Không cần tạo gate/test harness mới cho việc giảm thủ tục.

## 5. Hợp đồng chung và matrix

- `inventory.routes[]` quyết định chính xác `route`, `task`, `sourceFile`, `targetScreen`. Screen mới ở `apps/web/src/features/ledger/screens/<app-relative-directory>/screen.tsx`, wrapper dùng `LedgerScreenProps`/`resolveLedgerRouteInput` đã có; giữ async params/query và named export nghiệp vụ cần thiết bằng kiểm AST, không lấy render cũ.
- Presentation ở `apps/web/src/components/ledger/{ui,kit,shell,workspace}/`; thiết kế, menu grouping, typography, tokens và assets lấy từ preview. Href vẫn trỏ URL baseline. Thiếu workflow thì compose bằng Ledger, không thêm fallback cũ.
- `ledgerRequest` chỉ tái xuất/delegate đúng semantics/signature của request baseline, không tạo client/auth/recovery store thứ hai. Query key chứa `getAuthorizationScope(user)`; purge dữ liệu riêng khi đổi actor/org. Permission revision cùng actor không được làm mất form/pending body.
- `CommandDialog/CommandForm` mới dùng engine baseline. Unknown outcome giữ nguyên body/key/signature, khóa chỉnh payload và reconcile/retry command gốc; không tạo request mới để né pending. Không hiển thị success khi chưa có kết quả xác định.
- Shared producer: Task 9 tạo evidence-panel/evidence-pick/revision-history/image-gallery; Task 12 tạo partner-profile; Task 15 tạo lineage-panel trước Task 16. `use-now.ts` đã port sớm ở Task 6; Task 14 dùng lại. Các consumer không port lặp.
- Matrix vẫn giữ toàn bộ route/action, endpoint/method, type, role/capability/scope, retained headless logic và implementation. Không xóa nghĩa vụ để giảm test. `tests` được phép rỗng với action trình bày thuần túy đã đối chiếu; thêm `verification` ghi `method` (`test`, `source-review`, `visual`), đường dẫn implementation/nguồn và kết quả để giải thích `verified`. Không ghi test không thực sự kiểm nhánh đó.
- Giữ các metadata browser đã có. Chỉ route được browser chọn mới cần actor/scenario/fixture/readyHeading hoạt động; không bắt tạo toàn bộ fixture cho route được source-review. Mỗi dynamic URL vẫn phải có ví dụ canonical hợp lệ và giữ đúng tham số/token/query, không suy token trace thành database ID.
- Nếu gate matrix đang mặc định mọi action phải có test thì chỉnh riêng tiêu chí coverage theo chính sách này; không nới gate quyền, protected paths hoặc provenance. `verified` là đã kiểm bằng phương pháp được ghi, không mặc nhiên có browser/live evidence.
- Task 1 đã quét file preview mới/đổi/mất, kể cả ignored, trước snapshot. Sau đây chỉ kiểm hash các nguồn task dùng; không scan lại live preview mỗi vòng. Thay đổi ngoài snapshot cần quyết định riêng, không tự đuổi theo preview đang sửa.

## 6. Các task triển khai

Giữ nguyên ID và thứ tự phụ thuộc. Số route dưới đây lấy từ inventory; không dùng tên ví dụ để thay thế danh sách đó. Tasks 7–17 dùng fixture/spec hiện có nếu phù hợp; chỉ tạo file mới khi cần theo mục 4.

### Task 1: Pin baseline and route/UI provenance contracts — hoàn thành

Đã fetch/pin baseline, chốt 143 route và snapshot 127 file sau rà soát added/changed/missing; tạo audit/provenance/scope gates và matrix. Commit `bddc4ad` và follow-up trích call-site đưa matrix lên 803 nghĩa vụ. Không làm lại hoặc đóng snapshot lần nữa.

### Task 2: Upgrade Next 16 and async routing — hoàn thành

Đã nâng runtime đúng version, native SWC/Turbopack, Tailwind 4 và async route resolver; commit `dc0803e`. Production build/standalone smoke thực hiện một lần ở Task 18.

### Task 3: Port Ledger kit, shell and scoped providers — hoàn thành

Đã port Ledger-only primitives/kit/shell/fonts/styles và provider scope; commit `42e2551`. Visual desktop/mobile/theme/locale đã có evidence local; không chụp lại chỉ để tick task.

### Task 4: Connect auth and browser fixtures — hoàn thành

Đã chuyển 4 auth route, baseline session/MFA/password/invitation/signup/OTP, typed browser fixture và payload upload thực; commit `d9a1bdc` cùng follow-up ở Task 5. Không viết lại test auth ở từng domain.

### Task 5: Wire baseline command/recovery to Ledger dialogs — hoàn thành

Đã nối journal/pending/reconcile, giữ form khi permission revision và purge khi đổi actor; commit `60279fb`. Unit/shared tests có sẵn. Task 10 chỉ bổ sung tích hợp sản phẩm reload/two-tab còn thiếu; không dựng engine recovery mới.

### Task 6: Platform admission, identities and governance — hoàn thành

Đã chuyển 23 route / 80 nghĩa vụ; commit `c4b8833`. Kết quả đã ghi: governance browser 62/62, auth 8/8, Vitest 64 file/353 test, typecheck/lint và 12 audit gate đạt. Tiếp tục từ Task 7; không lặp các check này khi không đổi dependency liên quan.

### Task 7: Cases, support, privacy and recall coordination — đang làm, 10 route

- Tiếp tục 5 route chưa xong sau checkpoint privacy `f9ef2c7`; kiểm tra diff đang làm trước khi sửa. Giữ nguyên 3 route cases, 2 route privacy và test đã đạt.
- Port case timeline/decision panel, support inbox/detail, consumer report triage, recall drill/notices, platform/account privacy từ đúng references; compose workflow thiếu bằng kit Ledger. Nối baseline quyền hẹp và audit history, PII đúng scope; không cấp platform role quyền ghi lô/kho.
- Dùng `tests/ledger/platform-cases.spec.ts` và `fixtures/platform-cases.ts` đang có. Privacy scope/command đã có test; chỉ bổ sung workflow support/recall khác cơ chế chưa được bảo vệ, không tạo một bộ test cho mỗi timeline/filter. Giữ test hiện có, chạy lại khi shared dependency của chúng thay đổi.
- Hoàn tất matrix Task 7 và commit local sau typecheck + subset liên quan. Không đánh dấu xong chỉ dựa vào 5 route cases/privacy.

### Task 8: Platform read views, operations and billing — 19 route

- Port operations tabs, ledger transactions, reports/directory/read-products/lots/chains/QR, reference/monitor/backup/security alerts/statistics và billing; giữ query/filter/pagination/export/deep link.
- Chỉ cho price publish/manual settlement mà baseline cho phép; Admin/Auditor không có enterprise write, operator không có outbox retry/binding fix/backup giả. Không tự kích hoạt dịch vụ từ trạng thái thanh toán.
- `platform-operations.spec.ts`: chọn một read/report workflow và một billing mutation có allowed/denied branch. Các bảng đọc tương đồng dùng kiểm source/matrix và visual đại diện; không 19 browser heading tests.

### Task 9: Enterprise overview, membership, roles, profile and preferences — 14 route

- Tạo shared `components/ledger/workspace/{evidence-panel,evidence-pick,revision-history,image-gallery}.tsx` trước các consumer. Port preview workspace profile và nguồn shared đã ghi inventory.
- Port overview/inbox, tier tree, member detail/edit/invite, role/group permission, owner transfer, profile amendment và settings. Giữ OTP/password delivery, email bất biến, tier-2 scope/tier-3 denial, permission dependencies và owner-transfer deadline.
- Evidence dùng download authorization, đúng kind/count, supersession/revision/withdrawal; không cache private URL qua actor. Locale/preferences không đổi quyền và không mất form.
- `enterprise-membership.spec.ts`: ưu tiên membership/owner workflow có denial, evidence private và **một** browser đổi actor thực sự: đã render A, B chưa trả response thì A phải biến mất. Shared provider unit đã có, không nhân thử đổi actor ở mọi domain.

### Task 10: Product management and evidence — 5 route

- Port preview products list/actions/drawer; giữ list/search/filter/pagination/new/detail/edit/status, CSV preview/apply và deep link. Dùng shared evidence/revision Task 9.
- Giữ DTO, digest/CSV parser, MIME/size, required evidence/3 ảnh theo baseline; không thêm Excel endpoint hoặc state thành công giả.
- `enterprise-products.spec.ts`/`commands.spec.ts`: giữ **một** unknown-outcome → reload → reconcile, COMMITTED không POST lại; **một** two-tab case nếu chưa được consumer browser hiện có bảo vệ. Dùng endpoint thật `/enterprise-workspace/products/{id}`, không `/catalog/products` minh họa cũ.
- Chỉ thêm TDD nếu đổi parser/payload/validation; tái dùng unit CSV quote/newline/formula và shared recovery. Không lặp browser cho từng locale/permission revision.

### Task 11: Farms, plots, materials, sites and vehicles — 13 route

- Port nguồn mới `w/areas`, `w/materials`, `w/sites` và references tương ứng. List/form riêng phù hợp từng domain; compose subroute còn thiếu, dùng evidence/revision Task 9.
- Giữ assignment, version, evidence kind/count/completion, deactivation khi có stock; không suy tồn kho từ capacity.
- `enterprise-resources.spec.ts`: chọn một create/edit hoặc revision workflow và điều kiện evidence/deactivation đặc thù. Các resource CRUD có cùng cơ chế dùng source review toàn bộ mapping, không TDD/browser lặp từng family.

### Task 12: Partnerships, messaging, service onboarding and commerce — 15 route

- Tạo shared `workspace/partner-profile.tsx` từ preview rồi port partners search/invite/accept/external partner, internal messages/notices/help/support, billing renewal, signup review, quote/contract/payment/connections. Dùng evidence Task 9.
- Giữ simulation label, quota/capability/service gates, signed acknowledgements và baseline payment semantics. Không fake checkout, tự kích hoạt trả phí hoặc coi accept partner là chain membership. Peer forms chỉ public metadata, không SSH/signing keys.
- `enterprise-coordination.spec.ts`: chọn partner acceptance có scope và service/contract transition quan trọng. Không test mọi inbox row/tab hay biến thể copy; đối chiếu đủ actions qua matrix.

### Task 13: Chain management, plans, permissions and signing — 10 route

- Port preview chains list/create/detail/stages/invites/grants editor, compose baseline consent/plans/business ledger/signing/key views còn thiếu.
- Dùng canonicalization, Ed25519, IndexedDB key store, epochs/binding và accepted assignment/allowed capability baseline. Không xuất private key hoặc fallback unsigned.
- `supply-chain-signing.spec.ts`: một workflow ký thật tại frontend consumer với payload/key đúng và negative bị sửa payload/không đủ quyền ở tầng phù hợp. Chạy signing/canonicalization/distribution-signer tests sẵn có khi thay adapter; không thử mọi role × key × screen.

### Task 14: Production, journals, harvest, compliance and IoT — 11 route

- Port preview `w/cycles` và references. Tạo `lib/ledger/ops-labels.ts`; **dùng lại `use-now.ts` đã port Task 6**, không tạo bản thứ hai.
- Giữ production types, assignment, sensor windows, evidence, current version và harvest recovery. Không thay workflow bằng form JSON tổng quát.
- `production-harvest.spec.ts`: chọn cycle/harvest thành công và stale-version giữ quantity đã nhập/không báo success; kiểm unassigned denial bằng test quyền sẵn có hoặc targeted test nếu có gap. Không nhân toàn bộ sensor-window unit thành browser.

### Task 15: Lots, inventory, distribution, custody and enterprise QR — 10 route

- Port preview `w/lots`, `w/inventory`, `w/distribution`, `w/qr`. Tạo shared `workspace/lineage-panel.tsx` trước Task 16; dùng evidence Task 9.
- Giữ allowedCommands/status/ownership/available quantity/private balances, phân biệt legacy Shipment và multi-line Distribution, ký và custody. Hiển thị recall/expiry/integrity warnings độc lập với proof.
- `inventory-distribution.spec.ts`: một transfer/distribution workflow giữ quantity/version và unknown-outcome exact key khi cơ chế payload khác consumer đã kiểm. Tái dùng unit precision/overdraw/custody/signer; không viết lại arithmetic hoặc generic recovery tests cho mỗi màn. QR chỉ điều hướng same-origin theo baseline parser.

### Task 16: Processor workflows and mass balance — 4 route

- Port preview `w/processing`: run list/create/detail/complete/cancel, conversion factor và output lineage. Dùng Task 15 lineage và Task 9 evidence.
- Giữ PROCESSOR capability/org authority, raw-lot ownership/availability, unit conversion và mass balance. Không tự tính success trước response hoặc bỏ version.
- `processing.spec.ts`: một complete workflow và invalid balance/stale rejection tại điểm UI; tái dùng domain validation hiện có thay cho unit test mirror từng form field.

### Task 17: Public landing, legal, scanner, trace and global states — 5 route

- Dựng mới trên LedgerPublicShell từ design system preview; preview thiếu landing/trace thì compose mới, không đọc UI cũ làm mẫu. Giữ nội dung pháp lý/nghiệp vụ, canonical token semantics và global loading/empty/error/404.
- Scanner cần user consent, stop camera khi unmount/hidden, fallback manual khi bị từ chối; parser same-origin, bad image handling. Không đoán token là UUID theo độ dài.
- Trace giữ private/public boundary và recall/expiry/integrity warnings: VERIFIED không phải chứng nhận chất lượng.
- `public-trace.spec.ts`: chọn trace có warning, scanner/manual với unsafe QR và một global/error flow nếu khác cơ chế. Tái dùng QR/parser tests; không yêu cầu phần cứng camera thật hoặc cross-product theme/locale để đóng port UI.

### Task 18: Remove legacy UI and accept the branch

1. Xóa hết legacy presentation/dependencies trong inventory; renderer đang giữ/import phải bằng 0, không fallback/mock runtime. Chỉ miễn trừ headless đã kiểm AST. Kiểm protected paths và diff so đúng baseline, không so `origin/main`.
2. Đối chiếu đủ 143 route và mọi action với implementation Ledger/API baseline. Matrix phải có bằng chứng phù hợp theo mục 5; không bắt `tests.length > 0` ở tất cả row/action. Static route coverage kiểm đúng wrapper/screen/import/URL, không cần mở 143 trang chỉ để tìm heading. Có thể thêm một test tĩnh nhỏ vào gate hiện có thay vì tạo framework matrix/fixture mới.
3. Chạy một lần các lệnh cuối ở mục 7 trên trạng thái hoàn chỉnh. Không chạy thêm root monorepo `npm run check` (gồm backend/Worker/chaincode) cho scope này.
4. Visual cuối chỉ chọn khoảng 6 màn đại diện cho auth, platform, enterprise form/evidence, operations, processing/distribution và public trace. So với snapshot preview ở 1440px và 390px; spot-check 320/768px trên layout đặc thù nếu chưa có evidence. Chỉ cần mẫu sáng-VI/tối-EN, không mọi tổ hợp. Dùng lại ảnh/evidence còn đúng code; kiểm một flow keyboard/focus/Escape/reduced-motion cho primitives, mở rộng khi có lỗi cụ thể.
5. Chạy standalone Docker smoke web một lần vì runtime Next đã đổi: server startup, login, public trace, asset/image và same-origin proxy. Dùng container cách ly, real-API/non-mock config; không thay container đang chạy hoặc deploy. Không ghi thử lên production. Không gọi fixture smoke là API/Fabric acceptance.
6. Một reviewer fresh-context role **`agritrace-reviewer`** kiểm toàn nhánh: exact baseline/head, diff/changed paths, spec/plan, provenance/matrix, preview references và kết quả thực. Trọng tâm: UI cũ/fallback, quyền/API/recovery/scope, signing/custody/privacy, missing actions/fake success. Reviewer chỉ đọc; không đọc legacy JSX/CSS làm design reference.
7. Xác minh và sửa findings Critical/Important, TDD cho lỗi logic rồi chỉ chạy check bị ảnh hưởng; không review lại cả nhánh hoặc lặp broad suite nếu không có lý do mới. Lỗi build/import/shared runtime vẫn cần chạy lại gate tương ứng. Reviewer không khả dụng thì dùng agent thường với hướng dẫn reviewer repo và nói rõ fallback.
8. Sửa `docs/frontend.md` nếu hướng dẫn runtime/UI đã đổi; kết thúc bằng local commits, ledger đúng tình trạng và handoff. Giữ worktree để người dùng xem; không push/PR/merge/deploy/archive.

## 7. Lệnh nghiệm thu cuối

Các lệnh dưới đây chạy tuần tự **một lần tại Task 18**; chỉ chạy lại gate bị ảnh hưởng sau sửa lỗi. Kết quả chưa chạy không được ghi là đạt.

```powershell
node --test scripts/ledger/audit-baseline.test.mjs scripts/ledger/check-ui-origin.test.mjs scripts/ledger/check-change-scope.test.mjs apps/web/scripts/runtime-contract.test.mjs
node scripts/ledger/check-ui-origin.mjs --inventory docs/superpowers/specs/2026-10-22-ledger-ui-migration.inventory.json --phase final
node scripts/ledger/check-change-scope.mjs --base e1415e91eaaa96aab7b12f9cb972b109296b5720
npm run check --workspace apps/web
npm run lint --workspace apps/web
npm exec --workspace apps/web -- playwright test --config playwright.ledger.config.ts --project=contract --reporter=dot
git diff --check
```

`apps/web` check hiện gồm typecheck, Vitest, lint-contract, image-optimizer tests và production build; lint source chạy bằng lệnh riêng ở trên. Không chạy lại từng phần của check sau khi cả lệnh đã đạt cùng trạng thái code.

Docker smoke thực hiện theo Dockerfile/runbook hiện hành một lần, không tạo harness mới. `npm run test:hybrid:browser` và kiểm thử backend/DB/Fabric không mặc định bắt buộc cho port presentation: chỉ chạy phần liên quan nếu có trigger ở mục 4, ghi rõ đường thật đã kiểm. Không nhận nghiệm thu phần hành vi đang có rủi ro chưa giải quyết; cũng không dùng thiếu phần cứng camera/PWA HTTPS/Fabric production không bị tác động để lặp kiểm UI vô hạn.

Kiểm staged paths, lockfile scope, diff và Git status trước commit. Test không chạy do không liên quan ghi là **không áp dụng theo phạm vi**, khác với gate cần chạy nhưng **chưa đạt/thiếu prerequisite**. Sau mọi gate cần thiết và reviewer, bàn giao bằng HEAD SHA, phần hoàn thành, kết quả thật và giới hạn môi trường; không gọi intercepted fixtures là nghiệm thu live.

## 8. Bàn giao chat tiếp theo

Khi được yêu cầu triển khai tiếp, đọc bản plan/spec đã sửa ngày 23/10/2026 và ledger hiện có; kiểm Git trước khi viết. Tiếp tục Task 7 hoặc task chưa hoàn thành mới nhất, không làm lại Tasks 1–6. Dùng chính sách test theo rủi ro ở mục 4; giữ inventory và các component dùng chung đã hoàn thành. Một writer Native, một reviewer cuối; chỉ commit local. Việc sửa plan trong chat này không tự bắt đầu lại công việc triển khai đã bàn giao sang chat khác.
