# AgriTrace Ledger UI Migration — Design Spec

Ngày chốt: 22/10/2026. Đây là bản ghi các yêu cầu người dùng đã thống nhất; không phải yêu cầu triển khai trong chat đã viết tài liệu.

## 1. Mục tiêu và các quyết định đã chốt

Thay **toàn bộ lớp giao diện** của nhánh `feature/admin-console-processor` bằng UI/UX của `agritrace-admin-preview`, đồng thời giữ mọi chức năng thật của baseline. Việc thay màu, font, CSS hoặc bọc giao diện mới quanh bố cục cũ **không đáp ứng yêu cầu**.

Phạm vi gồm admin; doanh nghiệp; đăng nhập/đăng ký/nhận lời mời/đổi mật khẩu; sản xuất, thu hoạch, lô, kho, phân phối, vận chuyển, chế biến, ký; landing, trang pháp lý, quét và truy xuất QR; các trạng thái loading/empty/error/404. Preview thiếu màn hình nào thì xây màn hình đó trực tiếp trên nhánh mới, theo Ledger.

Người dùng đã chọn **Next.js 16**, **toàn bộ web**, **không sửa preview**, và **Native**. Không hỏi lại những lựa chọn này. Việc đọc prompt bàn giao có câu “hãy thực thi” là yêu cầu triển khai; nếu chỉ được yêu cầu xem/review/viết plan thì chỉ làm công việc đó.

## 2. Nguồn và trạng thái đã kiểm tra

| Nguồn | Đường dẫn / ref | Vai trò |
|---|---|---|
| Repository điều phối | `C:/Users/kieup/Desktop/agri-trace-blockchain` | Chứa plan/spec này; không dùng checkout hiện tại làm baseline |
| Nhánh nghiệp vụ | `origin/feature/admin-console-processor` | Fetch ở thời điểm thực thi rồi ghi SHA |
| SHA đã khảo sát | `e1415e91eaaa96aab7b12f9cb972b109296b5720` | Có 143 page route; không phải lời hứa remote sẽ đứng yên |
| Checkout hiện tại khi lập plan | `feature/enterprise-registration-plans` tại `61fcbb3` | Có UI Studio Admin khác; giữ nguyên, không đưa vào migration |
| UI/UX được chọn | `C:/Users/kieup/Desktop/Fe-clone-Agritrace/agritrace-admin-preview` | Preview của Claude, design system tên nội bộ “Ledger” |
| Nhánh / workspace đích | `refactor/ledger-ui-migration` / `C:/Users/kieup/Desktop/agri-trace-ledger-ui` | Tạo khi bắt đầu thực thi bằng skill worktree |

Không nhầm nguồn UI với `C:/Users/kieup/Desktop/FE-Clone_Agritrace` (dấu gạch dưới), `agritrace-ui-preview`, hoặc `agri-trace-admin-ui`. Không dùng các project đó làm tham chiếu thiết kế.

Preview đang dùng mock mặc định và có các phần doanh nghiệp cần đối chiếu/hoàn thiện; nó là nguồn **thiết kế**, không phải nguồn nghiệp vụ hoặc ứng dụng production đã nghiệm thu. Không sửa lỗi mock preview thay cho việc nối UI với backend baseline.

Danh mục file cụ thể, route, task sở hữu và hash nguồn nằm tại [inventory](2026-10-22-ledger-ui-migration.inventory.json). Inventory được thu bằng tên file/hash và metadata Git; không đưa nội dung UI cũ vào tài liệu.

Đã cập nhật nguồn preview ngày 22/10/2026: inventory có **127 đầu vào thiết kế/trình bày**, cập nhật 8 hash và bổ sung 19 file gồm 11 page doanh nghiệp, 5 component dùng chung và 3 helper hiển thị. Đã có UI cho sản phẩm, vùng trồng, vật tư, hồ sơ, chuỗi, sản xuất, lô, kho, phân phối, chế biến và QR doanh nghiệp. Các task phải lấy UI hiện có này rồi nối với baseline; chỉ dựng bổ sung những workflow/subroute còn thiếu. Thay đổi preview không tự thay đổi phạm vi 143 URL nghiệp vụ phải giữ.

## 3. Global Constraints

- Thay toàn bộ web; không bỏ bất kỳ chức năng hoặc URL hiện hành nào của baseline.
- Nguồn nghiệp vụ duy nhất: origin/feature/admin-console-processor sau fetch; SHA đã khảo sát: e1415e91eaaa96aab7b12f9cb972b109296b5720.
- Nguồn UI/UX duy nhất: C:/Users/kieup/Desktop/Fe-clone-Agritrace/agritrace-admin-preview, chỉ đọc.
- Không sử dụng lại bố cục, cấu trúc trình bày, component giao diện, CSS, design token, navigation hoặc ảnh chụp của UI cũ, kể cả đổi tên file hay đổi màu.
- Nhánh mới: refactor/ledger-ui-migration; worktree dự kiến: C:/Users/kieup/Desktop/agri-trace-ledger-ui; một writer cho mỗi checkout.
- Không merge/cherry-pick nhánh feature/enterprise-registration-plans hoặc commit giao diện 61fcbb3 vào nhánh mới.
- Next.js 16.4.2; React và React DOM 19.3.0; Tailwind CSS 4; giữ Node/npm theo engines của repository.
- Backend NestJS, database, migration, API contract, Worker và chaincode giữ nguyên theo baseline.
- Runtime thật dùng API thật; không nhập mock server, mock quyền, tài khoản demo hay dữ liệu giả từ preview.
- Giữ auth/session, organization scope, allowedCommands, version, idempotency, recovery và chữ ký của baseline.
- UI thiếu trong preview được xây mới trên nhánh đích bằng hệ Ledger; không dùng UI cũ làm fallback.
- Native đã được người dùng chọn: một implementer tuần tự, TDD theo task, một reviewer độc lập toàn nhánh cuối cùng.
- Chỉ tạo commit local đúng phạm vi; không tự push, mở PR, merge hoặc deploy.
- Không đọc/in secret; không commit memory, launch config, .codegraph, .claude, .codex, .superpowers scratch hoặc evidence local.

## 4. Ranh giới “giữ logic / bỏ giao diện”

**Được giữ:** API client và generated types của baseline; auth/session coordination; organization/permission scope; validation; command request/recovery; quantity/custody rules; QR parsing/generation thuần logic; canonicalization, WebCrypto/IndexedDB signer; backend và kiểm thử nghiệp vụ. React context không tạo DOM hiển thị được xem là hạ tầng, không phải UI.

**Phải thay:** toàn bộ renderer JSX/HTML, app frame, header/sidebar/menu/breadcrumb, bảng, form, modal/drawer, confirmation dialog, loading/error/empty state, charts, camera controls, gallery, page layout, CSS và design tokens cũ. Quy tắc này áp dụng cả renderer nằm trong `src/lib`, không chỉ `src/components`.

**Không được lách:** copy component cũ sang tên/thư mục mới; giữ DOM cũ rồi phủ token Ledger; giữ sidebar cũ và đổi nhãn; dùng screenshot cũ làm mẫu; đọc JSX/CSS/render cũ vào context thiết kế; render UI cũ khi màn hình mới thiếu. Chỉ các URL và quy tắc nghiệp vụ được giữ, không giữ cấu trúc thị giác.

Nếu một quy tắc nghiệp vụ chỉ nằm lẫn trong file UI cũ, được dùng TypeScript AST để trích **tên API call, trường payload, schema validation hoặc hàm không render**; đầu ra phải loại bỏ JSX, HTML, className, style, labels, menu grouping và layout. Không dán cả component cũ vào context. Bổ sung quy tắc đó vào ma trận rồi dựng renderer mới từ Ledger.

Kiểm tra provenance tự động ngăn import/copy nguyên bản hoặc phụ thuộc gián tiếp vào UI cũ; nó không chứng minh được mọi trường hợp sao chép bố cục đã chỉnh sửa. Bởi vậy bắt buộc thêm so ảnh với **preview**, kiểm nguồn và reviewer độc lập ở cuối.

## 5. Kiến trúc đích và quy tắc tích hợp

- Các route hiện hành vẫn là URL chuẩn; file route chỉ nối tới screen mới. Ví dụ `/admin/enterprises`, `/enterprise/products` và `/trace/[lotId]` không bị đổi thành URL của preview. Tên tham số `lotId` ở trang trace không cho phép thay token truy xuất công khai bằng database ID.
- Bộ trình bày mới đặt dưới `apps/web/src/components/ledger/`; feature screen mới dưới `apps/web/src/features/ledger/`. Cấu trúc menu và bố cục lấy từ preview, nhưng href trỏ tới URL baseline.
- Shared styles bắt đầu từ `src/app/globals.css` của preview. Giữ IBM Plex Sans/IBM Plex Mono, palette, khoảng cách, trạng thái, logo, sáng/tối, Việt/Anh của nguồn. Font/asset được phục vụ tại ứng dụng, không phụ thuộc preview đang chạy.
- `ledgerRequest<T>(path, init?, authenticated?, canRefresh?)` có đúng signature và semantics của `request<T>` trong baseline; request baseline đã unwrap envelope và đã điều phối command recovery. Không tạo engine auth/recovery thứ hai.
- Query key mang authorization scope của baseline; đổi tài khoản/tổ chức, logout hoặc revoke quyền phải xóa dữ liệu riêng trước khi hiển thị danh tính mới.
- `CommandDialog/CommandForm` lấy UI từ preview; submit đi qua API baseline. Khi command chưa rõ kết quả, khóa sửa nội dung và dùng `listPendingCommands()/retryPendingCommand(id)`; không sinh key mới để né trạng thái pending.
- DTO, enum, transition, scope và MFA lấy từ NestJS/OpenAPI baseline. UI preview không có quyền tự bổ sung nghiệp vụ mới, tự kích hoạt dịch vụ hoặc tự nâng quyền.
- Chức năng tùy chỉnh giao diện đang có được dựng lại bằng controls Ledger; default và stylesheet theo Ledger. Các giá trị lưu cũ chỉ là dữ liệu đầu vào, không được mang palette/renderer cũ trở lại.
- Nâng Next/React đúng phiên bản đã chốt; Tailwind 4 qua PostCSS, native SWC/Turbopack, async request APIs và standalone Docker output. Loại ép SWC WASM 15; không thay controller/deployment generation.
- Không đưa Preview panel, tài khoản giả, đổi role giả hoặc mock permissions vào runtime thật. Giữ mock/fixture chỉ trong kiểm thử có kiểm soát.

## 6. Coverage và hợp đồng bàn giao giữa task

Ma trận thực thi phải có `route, sourceFile, targetScreen, task, exampleUrl, actorKey, scenarioId, readyHeading, actions, role/capability/scope, endpoint/method, request/response type, retainedLogic, tests, status`. Mỗi route có URL deep link đã điền ID/token fixture hợp lệ, actor/scenario và heading xác nhận screen đã tải. Baseline 143 route đã được chia chủ sở hữu trong inventory; không được kết luận đủ chỉ bằng số route hoặc HTTP 200.

Inventory UI ghi hash cả page layout, bộ component và asset của preview. Kiểm hash khi thực thi; nếu preview đã đổi, đối chiếu đúng các file đổi và ghi delta trước khi đóng snapshot local. `legacyUi` là danh sách ứng viên từ metadata: hạ tầng React không tạo UI được xác nhận bằng AST có thể chuyển sang `retainedHeadless`, kèm lý do; không được miễn trừ renderer, CSS, navigation hay design token. Component trùng mã upstream chỉ được lấy từ path/hash preview đã đóng băng, có provenance và không giữ import/path UI cũ.

`uiSource.taskReferences` chỉ định chính xác nguồn UI cho từng task; chỉ nạp mục của task đang làm và các hash tương ứng. `uiSource.discovery` yêu cầu quét lại cả file trình bày mới, file đổi và file mất, kể cả file bị ignore, trước khi đóng snapshot. Cập nhật hash/tham chiếu của phần thay đổi rồi cố định nguồn cho đợt thực thi; không đuổi theo preview đang sửa giữa chừng. API/auth/permission/validation/signing/mock của preview vẫn bị loại khỏi runtime đích; helper hiển thị mới không thay quy tắc nghiệp vụ baseline.

Quyền sở hữu component đích dùng chung theo thứ tự thực thi: Task 9 tạo evidence-panel/evidence-pick/revision-history/image-gallery để phục vụ hồ sơ và các domain sau; Task 12 tạo partner-profile; Task 15 tạo lineage-panel trước Task 16 chế biến. Task tiêu thụ dùng lại component Ledger mới này, không port lặp và không lấy component từ UI cũ.

Nếu SHA sau fetch khác SHA khảo sát: tạo lại inventory bằng metadata/AST đã lọc render, cập nhật các khác biệt hợp đồng và task bị ảnh hưởng trong ledger. Không lấy thiếu sót của inventory cũ làm lý do bỏ tính năng.

Mỗi domain chỉ là một đợt chuyển đổi, không phải một sản phẩm độc lập. Shared UI, auth, adapter và quyền dùng chung nên triển khai Native tuần tự; không chia nhiều writer vào cùng checkout.

## 7. Kiểm thử và điều kiện hoàn tất

- TDD cho hành vi mới/rủi ro: quan sát RED đúng lý do, thay đổi tối thiểu, GREEN, commit. Không viết test chỉ để lặp lại màu/class hoặc làm đẹp số lượng test.
- Smoke/contract browser dùng interception có type, chặn mọi API request ngoài fixture; **không** xem đó là bằng chứng API/Fabric thật.
- Dùng harness backend/DB/Fabric cách ly hiện có của repo cho live workflow. Chỉ một heavy job local mỗi lúc. Không dùng stack demo hoặc tài khoản production để ghi kiểm thử.
- Kiểm 320, 390, 768, 1440 px; sáng/tối; VI/EN; keyboard/focus/Escape/reduced-motion; tên/hash dài; lỗi/mạng chậm/empty; toàn bộ route và deep link.
- Giữ nguyên các test và assertions nghiệp vụ; chỉ đổi selector/render assertions cần cho Ledger. Không skip test, nới authorization, ép kiểu hoặc đổi backend để làm xanh.
- Chạy `npm run check --workspace apps/web`, các browser tests mới, harness nghiệp vụ hiện có và Docker standalone. Nêu rõ checks chưa chạy hoặc prerequisite thiếu; không gọi mock/skip là nghiệm thu runtime.
- Final gate phải không còn legacy renderer/CSS đang được giữ hoặc import, không có fallback UI cũ, không có dữ liệu mock runtime, và không đổi các đường dẫn protected trong inventory.
- Giữ warnings thu hồi/hết hạn/toàn vẹn độc lập với proof; `VERIFIED` không có nghĩa được chứng nhận chất lượng. Camera không tự bật; input QR chỉ điều hướng trace hợp lệ cùng origin.
- Signer dùng cơ chế khóa và ký baseline; không xuất private key hoặc fallback sang unsigned khi chữ ký không tạo được.

## 8. Kết thúc và giới hạn quyền

Người dùng đã chọn Native nhưng chat hiện tại chỉ viết kế hoạch. Khi được yêu cầu thực thi ở chat mới, dùng `superpowers:executing-plans`; kiểm ledger trước để tránh làm lại task đã commit. Một reviewer fresh-context dùng role `agritrace-reviewer` ở cuối; nếu client không có role này, dùng agent thường với hướng dẫn reviewer repo và nói rõ fallback.

Chưa được yêu cầu push, tạo PR, merge, deploy, sửa nguồn preview hoặc dọn/xóa worktree khác. Giữ nhánh và worktree đích để người dùng xem. Artifacts/ledger/ảnh/log là local và phải được ignore; plan/spec/inventory là tài liệu kỹ thuật có thể commit trên nhánh đích.
