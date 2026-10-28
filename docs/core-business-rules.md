# Current business rules and acceptance boundaries

Updated 2026-10-16. Use current source, SQL guards and generated Swagger for the
implemented API, and current AGT issues for acceptance. The hosted Hybrid release
is still undergoing validation; the rules below are requirements to preserve.

- A current authenticated account and session, organization, capability,
  membership, grant and accepted assignment authorize business actions. Check
  under locks and before replay. Read/list/count/proof/allowedCommands use the
  same scope. Production bootstrap is a private operator action, never a business write permission for Admin.
- Immutable ShipmentPlan revisions require current consent from every relevant
  party; changing a revision or revoking/regranting permission invalidates old
  consent. Finalize and domain changes are atomic.
  Mỗi acceptance lưu snapshot grant (id/revision), chain membership
  (id/version) và capability revision của bên đó. Finalize so lại snapshot dưới
  `lockContext` và trigger `fn_hybrid_plan_state`; suspend/revoke rồi rejoin
  membership hoặc revoke/regrant capability, dù cùng ORG_ADMIN grant, đều làm
  consent cũ mất hiệu lực. Snapshot là bắt buộc (`NOT NULL` từ migration
  `20261213000003_require_plan_consent_snapshot`).
- Idempotency-Key identifies the original normalized command body. Keep the
  original body and key for retries and inspection. A positive immutable journal
  can prove commit; PROCESSING/UNKNOWN without that proof cannot execute again,
  switch key or be rewritten to pass a gate. Status inspection never executes.
- Each harvest creates a Lot and sealed sensor window. The first interval is
  [plantedAt, cutoff], later intervals are (previous cutoff, cutoff]. NO_DATA is
  explicit count0/hashnull; late readings remain separate. Never rehash history.
- Quantities use decimal arithmetic, at most three fractional digits. Movement
  history must agree with available quantity; mismatch blocks writes. Shipment
  and Lot optimistic versions are checked together when both are involved.
- Farmer damage is before Shipment; transporter damage is during IN_TRANSIT;
  retailer damage is after ARRIVED. Receiving requires received>0 and reconciles
  received plus new damage with available. Rejection cannot subtract twice.
- Recall/expiry preserve actual custody. FAILED does not imply goods returned to
  the farmer. A missing or contradictory custody history blocks commands.
- Compliance reviewer independence applies across correction/submission history.
  Public certification is APPROVED, public, valid and not superseded by another
  approved record. Evidence verification and quality certification are separate.
- Business calendar dates use Asia/Ho_Chi_Minh. Expiry prevents sale after the
  recorded expiry date even before an expiry event. Do not invent missing dates.
  Business timestamps require an explicit timezone, millisecond precision and
  valid ordering; reject impossible/future instants.
- B captures an immutable binding/authority/permission epoch on each event.
  Registry permission confirmation precedes writes; revoke has drain/barrier or
  immediate emergency hold. Stale leases/epochs cannot overwrite newer state.
  Unknown delivery is reconciled/fenced, never redirected to another destination.
- C verifies an independent organization key and intent binding to actor, chain,
  event/entity, payload, nonce, expiry and expected versions. Intent is single use.
  DUAL_SIGNED custody changes only after matching offer and confirmation; reject,
  cancel and expiry preserve custody. Same-org confirmation is labelled internal.
- Historical migrations and archived events keep their original bytes/hash/txId/
  channel/proof/QR trust. Fresh production imports none of this business history.
  Cleanup refuses existing business data or historical route exemptions; it never
  rewrites hashes. Every event follows its cycle's ACTIVE binding; there is no
  technical fallback stream (release A and c1 are retired). Environments
  without Fabric use a simulated binding, never a separate write path.
- Public and authenticated readers fail closed for unsupported versions or scope.
  Show recall/expiry/integrity/missing-sensor warnings alongside proof state.
  Public trace tokens use 8–128 URL-safe ASCII letters, digits, `_` or `-`;
  malformed tokens return 400 and unknown valid tokens return 404. The timeline
  contains only the requested Lot and shared cycle events (`lotId IS NULL`).
  Proof aggregates the entire selected history: integrity warning takes precedence
  over unavailable delivery, then pending, then verified; empty history is pending.
  Public shipment fields are explicitly projected, never serialized wholesale.
- API contains no signer private key. Web signer retains a non-extractable device
  key and original signed command until outcome is known. Signer outage cannot
  downgrade a C shipment to an unsigned custody transfer.

Release tests must exercise these invariants on the exact candidate, including
concurrency, restart, restore and direct ledger verification. See
[the current release gates](plans/hybrid-production-readiness-2026-10-13.md).

## Enterprise workspace and source-preserving distribution

New registrations start by choosing one registration role: producer/cooperative,
processor, transporter, distributor, retailer, or a supply-chain enterprise that
registers at least two of these capabilities (registered legal forms only). They require a
five-step v2 profile, catalog-bound province/ward codes and exactly one OTP proof
for the owner login email; the contact email is not OTP-verified. Neither the
login email nor the contact email may match any existing account email or
enterprise contact email (case-insensitive). Signup takes no password: the API
generates a temporary password, marks the owner `mustChangePassword`, and queues
an encrypted `CREDENTIALS` mail to the verified login email; the Worker clears
the ciphertext once sent. OTP expires in 10 minutes, permits at most five
wrong attempts, and is single use for the bound registration. Resend waits 60
seconds and is limited per email. Exact verification retries preserve the attempt.
Drafts exclude OTPs, proof tokens, files and acceptance checkboxes;
queued OTP and password content is encrypted.

Accounts created by someone else never receive a chosen password: enterprise
members (`POST /enterprise-workspace/members`, phone required) and platform
users (direct or approved `SYSTEM_ADMIN_CREATE`) get a generated temporary
password through an encrypted `ACCOUNT_CREDENTIALS` mail tied to the account and
must change it at first sign-in. Members carry an internal code `NV0001…`
unique per organization; removing a member sets `INACTIVE`, revokes roles and
sessions, locks descendants and keeps history. A role can be deleted only when
no member or pending invitation uses it. Contact changes to the enterprise
profile are amendments reviewed by a platform administrator like legal ones.
External partners require phone, email, tax code, representative, note and at
least one `PARTNERSHIP_EVIDENCE` image. Partner search matches tax code, name
or AGT code and reports which group matched. Chains have a type (`CROP`,
`LIVESTOCK`, `AQUACULTURE`, `PROCESSED_FOOD`) and a supply model (stages with
their organizations); organizations other than the owner are invited when the
chain is created. These types only classify chains: production, harvest and lot
rules are still crop rules.

Human accounts must change their password every `PASSWORD_MAX_AGE_DAYS` days
(default 30; `0` disables). Age counts from the last change, or from account
creation when the password was never changed. Login, refresh and the JWT guard
turn an expired password into `mustChangePassword`, which only permits
`/auth/me`, `/auth/change-password` and logout until it is replaced.
`IOT_DEVICE` and `SYSTEM_ACTOR` are exempt. Registered enterprises/cooperatives/business
households require a tax identifier, registration number and registration file.
Producer households and individual producers may omit these legal identifiers;
they must declare production activity. Production currently supports CROP only.
An authorized registrant requires an authorization file; a declared certification
requires supporting evidence. The API stores genuine private uploads bound to
the verified owner email and claims them atomically with registration. Only the
enrollment owner and SYSTEM_ADMIN may download claimed files. Metadata/content
and submitted v2 acceptance evidence cannot be rewritten. Unclaimed uploads are
not public; automatic abandoned-upload retention cleanup is not implemented.
Service preferences do not create an order or business grants. Accuracy, terms
and privacy acknowledgements are separate required inputs; marketing is optional
and defaults off. The server records the policy version and acceptance timestamp.
New registration service preferences require TRACEABILITY; the form no longer
offers QR_LABELS (label printing was retired on 26/10/2026), while the API still
accepts it from drafts saved earlier. Other capabilities remain separate from signup preferences. A
rate-limited, no-store public email availability check returns only a boolean;
it never reserves an email or replaces atomic uniqueness at final registration.

Approval alone does not grant business authority for new enrollments. An owner
previews and acknowledges an immutable service quotation/contract, then local
simulated settlement records `PAID_SIMULATED` and queues the contract email; it
does not grant capabilities or organization roles. A separate SYSTEM_ADMIN
activation command grants the approved business authority and records
`ENTERPRISE_SERVICE_ACTIVATED`. Amounts come from the versioned server catalog,
never the submitted client. Real payment and qualified contract signatures remain
unimplemented. Existing enrollments retain their previous admission policy. SMTP
is Worker-only, requires TLS, and never relays reserved test recipients externally.
A self-managed connection request follows service activation; neither approval,
simulated settlement nor activation claims Fabric connection success.

The enterprise extension keeps production → harvest → source Lot unchanged.
New products are organization-owned; legacy shared products remain readable.
Platform administrators can read catalog records but cannot create products,
farms or plots. Enterprise administrators and delegated staff use current
`catalog.manage` scope for those writes. Platform-created users are limited to
system administrators and independent compliance reviewers; enterprise staff
must be created inside the approved enterprise hierarchy. Direct platform
organization creation is limited to independent auditor organizations.
Registration requires the five-step legal/account/activity/service profile. Admission
grants only reviewed capabilities, ORG_ADMIN and CREATE_CHAIN; it never grants
business access to another chain. Historical incomplete profiles remain flagged
for reviewers; new API registrations require the complete profile and OTP proofs.
Capability changes remain platform-reviewed.

Level 1 is the primary organization administrator. Level 2 may delegate only
its current permissions and chain/facility scopes to level 3. Level 3 cannot
administer accounts. A role assignment never replaces chain membership,
capability, production assignment or ledger permission. Removing/changing a
manager's delegation locks its child accounts and revokes their sessions;
restoring them requires explicit assignment by an authorized manager. A shared
role in use is immutable through the API: create another role and reassign each
member. Role writes include the read permissions necessary for that function.

An accepted enterprise partnership grants no raw trace or chain membership.
Distribution requires three independent approved participants, active chain
membership, matching capabilities and accepted sender/receiver/carrier links.
Transfers contain immutable source-lot lines, units, parties and facility
snapshots. Staff scope is checked on the persisted party facility, on reads,
counts, commands and replay. Quantity reports show organization holdings within
authorized chains alongside site allocations, transfer slips and quarantine
records. This is not a complete warehouse or accounting system.

For an allocated Lot:

```
global available = sum(organization holdings) + sum(in-transit transfer lines)
spendable holding = held quantity - reserved quantity
reserved quantity = sum(PROPOSED and READY outgoing lines)
```

All quantities use PostgreSQL Decimal(14,3). Lot locks serialize reservations;
deferred SQL guards check the complete transaction. Cancellation before pickup
releases reservations. Pickup requires both sender/carrier receipts; delivery
requires both carrier/receiver receipts. Three consents precede pickup.
Ed25519 receipts bind snapshot digest, phase, actor, key, version and expiry;
trace events additionally commit the signature and public-key digest. Private
keys stay on the signing device. Revoked accounts, keys, memberships or links
block unfinished transitions. Domain writes, trace/outbox and command journal
remain atomic. Unknown outcomes retain their original body, signature and key.

A source Lot cannot have both a single Shipment and distribution holdings.
Shipments are not converted or rewritten automatically. Shipment-flow Lot
actions are hidden for allocated Lots. Organization-level `quantity.adjust`
records physical sale/damage quantities and immutable movements; it does not
create orders, payments, valuation, accounting or warehouse optimization.
Carrier journal observations are labelled MANUAL, separate from IoT proofs.
Producer notices are explicit public projections. Recall notices block further
distribution and sale without erasing the physical holding or its history.

The new distribution receipt protocol is distinct from Fabric c2 signing
intents. Chains requiring DUAL_SIGNED remain on the existing signed Shipment
handover path; the API refuses new distribution there. Enabling distribution
on those bindings requires its own c2 integration and isolated Fabric
acceptance. Local PostgreSQL/browser checks do not establish that acceptance.
Public QR projects only the requested source Lot's distribution quantities and
organization names, excluding sibling lines, employee identities, signatures,
keys, contact profiles and precise facility addresses. Existing expiry,
sensor-integrity, certification and proof warnings remain independent.

## Quản trị nền tảng: nhật ký kiểm toán và MFA

Cập nhật 2026-10-18 (pha P0 quản trị nền tảng). Admin/Auditor vẫn không có quyền
ghi nghiệp vụ; phần này chỉ ràng buộc việc quản trị tài khoản và tổ chức nền tảng.

- **Nhật ký kiểm toán `platform_audit`** là append-only: trigger chặn
  UPDATE/DELETE/TRUNCATE, số thứ tự liên tục và `prev_hash` phải khớp đầu chuỗi
  (kiểm lại trong DB dưới advisory lock). `entry_hash` là SHA-256 của JSON chuẩn
  RFC 8785 gồm toàn bộ trường. Mỗi bản ghi được ghi **trong cùng transaction** với
  thao tác (không có "ghi nhật ký sau"), nên thao tác bị rollback không để lại
  vết. Chi tiết chỉ chứa metadata: khóa kiểu password/secret/token/OTP/recovery bị
  che; mật khẩu, OTP, seed MFA không bao giờ vào nhật ký hay response đã lưu.
  `GET /platform-audit/verify` dựng lại toàn chuỗi và báo bản ghi đầu tiên lệch.
  Chủ DB tắt trigger rồi sửa bản ghi vẫn bị phát hiện bằng verify; đó là giới hạn
  của chuỗi băm lưu trong cùng DB, cần neo đầu chuỗi ra ngoài nếu muốn chống
  admin DB (chưa làm).
- **Khóa/mở tài khoản và trạng thái tổ chức** cần `Idempotency-Key`, `version`
  hiện tại và lý do tối thiểu 10 ký tự. Khóa thu hồi mọi refresh session trong
  cùng transaction (cùng thứ tự khóa org → user như login/refresh). Không tự khóa
  chính mình; không vô hiệu hóa quản trị viên hoạt động cuối cùng. Admin chỉ đổi
  trạng thái tài khoản nền tảng (SYSTEM_ADMIN, COMPLIANCE_REVIEWER).
- **Mật khẩu và phiên:** admin đặt mật khẩu tạm (không trả lại, không ghi nhật ký)
  buộc đổi ở lần đầu; token của tài khoản đó chỉ dùng được `/auth/me`,
  `/auth/change-password`, `/auth/logout(-all)`. Tự đổi mật khẩu thu hồi mọi phiên
  khác. Tài khoản **nền tảng** bị khóa tạm sau N lần đăng nhập sai
  (`PLATFORM_LOGIN_MAX_ATTEMPTS`, `PLATFORM_LOGIN_LOCK_MINUTES`) cộng thêm throttler
  theo IP; email lạ, sai mật khẩu và đang bị khóa trả cùng một thông báo. Tài
  khoản doanh nghiệp không bị khóa theo cơ chế này để tránh bị khóa cố ý từ ngoài.
- **MFA TOTP (RFC 6238) cho SYSTEM_ADMIN:** seed lưu bằng AES-256-GCM với khóa
  riêng `PLATFORM_SECRET_KEY` (32 byte, không suy ra từ JWT secret), gắn AAD theo
  user; mã khôi phục lưu dạng HMAC. Mỗi bước thời gian chỉ dùng một lần; mã khôi
  phục dùng một lần. `PLATFORM_MFA_MODE`: `OPTIONAL` (mặc định, đã bật thì bắt buộc
  lúc đăng nhập và step-up), `REQUIRED`, `OFF`. Các endpoint nằm ở `/auth/mfa` (tự phục vụ, trả bí mật một lần nên
  không đi qua nhật ký idempotency). Thao tác rủi ro cao gửi mã trong header
  `X-MFA-Code`. Sai/thiếu mã step-up trả **403** (không phải 401, để web không
  hủy phiên) và không được ghi vào journal idempotency: cùng khóa và body vẫn dùng
  lại được với mã đúng. Bắt đầu đăng ký MFA đòi nhập lại mật khẩu; thiếu
  `PLATFORM_SECRET_KEY` trả 503 và không tính là lần đăng nhập sai. Định dạng seed
  có tiền tố phiên bản `v1.`. Operator xoay khóa bằng `rotate-platform-secret`
  khi API/Worker đã dừng; xem runbook. Công cụ xác minh toàn bộ ciphertext rồi
  đổi trong một transaction và thu hồi các mã khôi phục HMAC cũ một cách tường minh.
- **Không còn phê duyệt hai bước (maker–checker)** từ 2026-10-25: cấp năng lực
  tổ chức, cấp `CREATE_CHAIN`, tạo/đặt lại mật khẩu tài khoản quản trị, duyệt kết
  nối, công bố bảng giá, xác nhận thanh toán, đổi tham số và khóa QR đều do một
  `SYSTEM_ADMIN` thực hiện trực tiếp, có lý do khi lệnh yêu cầu và luôn ghi nhật ký
  kiểm toán. Endpoint `/platform-approvals` và biến `PLATFORM_APPROVALS_MODE`,
  `PLATFORM_APPROVAL_TTL_HOURS` đã gỡ; bảng `platform_approval` được giữ làm lịch sử.
- **Khóa nhật ký trước mọi khóa hàng:** mọi giao dịch có ghi nhật ký lấy advisory
  lock `platform_audit` ngay đầu giao dịch (trước cả khóa actor/org của
  `authorizeCommand`), nên khóa này không thể nằm trong chu trình deadlock và các
  thay đổi trạng thái được tuần tự hóa (hai admin tự vô hiệu hóa nhau không còn
  race). Đổi lại các thao tác ghi nhật ký chạy nối đuôi nhau; khối lượng quản trị
  thấp nên chấp nhận.
- Tài khoản nền tảng do admin tạo kèm mật khẩu bị buộc đổi ở lần đăng nhập đầu.
  Hash bcrypt của mật khẩu tạm trong đề xuất `SYSTEM_ADMIN_CREATE` /
  `ADMIN_PASSWORD_RESET` nằm lại trong `platform_approval.payload` (bất biến, chỉ
  bị che khi trả API) và hash yêu cầu idempotency của payload chứa mật khẩu tạm là
  sha256 không muối: ai đọc được DB có thể dò offline mật khẩu tạm, nên mật khẩu
  tạm chỉ có tác dụng đến lần đổi đầu tiên.
- **Giới hạn đã biết:** đăng nhập sai trên hai request song song có thể vượt ngưỡng
  khóa vài lần (đã có throttler theo IP); phê duyệt hồ sơ doanh nghiệp và kích
  hoạt dịch vụ vẫn là thao tác trực tiếp của SYSTEM_ADMIN, chưa qua phê duyệt hai
  bước. Kích hoạt riêng ghi `ENTERPRISE_SERVICE_ACTIVATED` và cấp authority;
  thanh toán mô phỏng chỉ ghi `SERVICE_PAYMENT_SIMULATED`, không kích hoạt quyền.
  Không ghi thông tin thanh toán/cá nhân vào sự kiện.
  Môi trường production phải truyền các biến `PLATFORM_*` vào container API
  (`docker-compose.app.yml` đã truyền các biến này; operator vẫn phải cấu hình
  khóa riêng trước khi bật MFA hoặc hộp thư dữ liệu cá nhân).
- Không có thao tác "đổi vai trò" tài khoản nền tảng trong API hiện tại nên chưa
  có sự kiện kiểm toán tương ứng.

## Bảng vận hành nền tảng (P1-1, chỉ đọc)

Cập nhật 2026-10-18. `GET /platform-operations/{summary,outbox,holds,ledger-jobs,
binding-health,mail}` cho `SYSTEM_ADMIN` và `AUDITOR` đọc; **không có route ghi**
nào (không retry, không sửa, không xóa, không giải phóng hold). Nếu cần thao tác
khắc phục thì viết thành đề xuất riêng và do operator thực hiện theo runbook.

- Chỉ trả đếm và metadata: không có người nhận, tiêu đề hay nội dung thư, không
  payload sự kiện, không khóa. Văn bản lỗi của Worker bị cắt 300 ký tự, một dòng;
  digest binding chỉ trả 16 ký tự đầu.
- Mặc định liệt kê **việc cần xử lý** (outbox PENDING/PROCESSING/RETRY/DEAD_LETTER,
  job PENDING/PROCESSING/FAILED, thư PENDING); trạng thái đã xong chỉ hiện khi lọc
  rõ. Phân trang cursor mờ (tối đa 100 mục/trang).
- Lọc theo `chainId` / `organizationId`. Mỗi phần có `scopedBy` cho biết bộ lọc nào
  áp dụng được (ví dụ thư và phiên chỉ lọc theo tổ chức, sức khỏe binding chỉ
  theo chuỗi); phần không lọc được vẫn là số liệu toàn nền tảng và giao diện ghi rõ
  điều đó để không bị hiểu nhầm là "trống".
- Ngưỡng: binding "cũ" khi quá 10 phút chưa được Worker kiểm tra; outbox/thư "quá
  hạn" khi lỡ lượt thử quá 5 phút. Thư thất bại không có trạng thái `FAILED`:
  Worker để `PENDING` với lượt thử sau; "đã thử lỗi" là `PENDING` có `attempts >= 2`.
- Các số liệu đọc trực tiếp từ bảng nên là ảnh chụp tại `generatedAt`, không phải
  bằng chứng Fabric thật; việc đối soát với ledger vẫn theo Hybrid runbook.

### Cảnh báo hạn chứng thư và khóa ký (P1-2, chỉ đọc)

`GET /platform-operations/credentials` (SYSTEM_ADMIN, AUDITOR) phân nhóm chứng thư
theo hạn: đã hết hạn, còn ≤ 7, ≤ 14, ≤ 30 ngày, và liệt kê chứng thư/khóa ký đã
thu hồi. **Giới hạn dữ liệu:** schema chỉ có ngày hết hạn chứng thư do Worker quan
sát trên từng kết nối (`binding_worker_health.certificate_expires_at`); vân tay
chứng thư đã duyệt (`fabric_credential_revision`) và khóa ký Ed25519 (`signing_key`)
không có cột hết hạn, nên với chúng chỉ có thông tin thu hồi (`expiryTracked:false`).
Chứng thư chưa được Worker báo hạn được đếm riêng (`unknownExpiry`), không coi là
còn hạn. Chỉ trả 16 ký tự đầu của digest/vân tay; không có khóa công khai, chữ ký
chứng minh sở hữu hay chứng thư. Thêm hạn cho khóa ký cần quyết định chính sách và
migration riêng.

## Hồ sơ sự cố và khiếu nại (P1-3)

Migration `20261030000000_platform_cases` thêm `platform_case` (hồ sơ) và
`platform_case_event` (lịch sử). **Hồ sơ chỉ là yêu cầu và thông báo gửi tổ chức sở
hữu; không có đường nào đổi trạng thái lô, số lượng, quyền giữ hàng hay thu hồi.**
Thu hồi vẫn là lệnh lô của FARM_STAFF/TRANSPORTER/RETAILER; test e2e kiểm lô nguyên
trạng sau cả vòng đời hồ sơ.

- Vòng đời: tiếp nhận (`OPEN`, hoặc `ASSIGNED` nếu có doanh nghiệp) → giao
  (`ASSIGNED`, kèm hạn phản hồi tương lai) → doanh nghiệp xác nhận (`ACKNOWLEDGED`)
  → phản hồi (`RESPONDED`) → đóng (`CLOSED`, lý do ≥ 10 ký tự). Admin có thể leo
  thang (`ESCALATED`) bất kỳ lúc nào và giao lại (xóa xác nhận/phản hồi cũ). Gắn lô
  mà không chọn doanh nghiệp: giao cho doanh nghiệp sản xuất lô.
- Quá hạn = có `responseDueAt` đã qua khi hồ sơ còn ở `ASSIGNED/ACKNOWLEDGED/
  ESCALATED`; chỉ được tính và lọc, **không có tiến trình tự leo thang** (leo thang
  là quyết định của admin).
- Lịch sử append-only (trigger chặn UPDATE/DELETE/TRUNCATE); hồ sơ `CLOSED` bất
  biến, `case_number`, nguồn và người tạo không đổi. Ghi chú có mức `INTERNAL`
  (chỉ nền tảng) hoặc `SHARED`; doanh nghiệp chỉ thấy hồ sơ giao cho mình, phần
  mô tả và lịch sử `SHARED`, không thấy nguồn, người tạo hay ghi chú nội bộ. Hồ sơ
  của tổ chức khác trả 404. Mô tả hiển thị cho doanh nghiệp nên **không ghi dữ liệu
  cá nhân của người khiếu nại** (xử lý riêng ở P1-5).
- Mọi thao tác admin cần `Idempotency-Key` và `version`, nằm cùng transaction với
  nhật ký kiểm toán nền tảng (`CASE_*`). Doanh nghiệp xác nhận/phản hồi qua
  `EW_CASE_ACK`/`EW_CASE_RESPOND` với quyền `cases.respond` (tài khoản cấp 1
  hoặc nhóm quyền có quyền này); đọc cần `cases.read`.
- AUDITOR chỉ đọc (`GET /platform-cases`); giao diện `/admin/cases` ẩn các form với
  AUDITOR và hồ sơ đã đóng.

## Diễn tập thu hồi (P1-4)

`GET /platform-recall/:lotId` dành cho SYSTEM_ADMIN, AUDITOR,
PLATFORM_OPERATOR và PLATFORM_CASE_MANAGER. Snapshot `RepeatableRead` đọc lô
nguồn, lô con, phân bổ hiện tại và các chặng giao nhận; không ghi domain, cảnh
báo, trace/outbox hoặc gửi thông báo. Chặng phân phối đã hủy không thuộc báo cáo.
Lượng luân chuyển qua nhiều chặng không được cộng thành tồn kho; lượng giữ chỗ
đã nằm trong lượng phân bổ. Mỗi phần tối đa 500 dòng, cây lô tối đa 20 cấp;
`truncated=true` nghĩa là phải đối soát bổ sung, không coi danh sách là đầy đủ.
Không trả địa chỉ giao hàng, liên hệ, payload hoặc chữ ký.

## Quyền dữ liệu cá nhân và hồ sơ vi phạm (P1-5)

`/privacy-requests` nhận yêu cầu của tài khoản đang đăng nhập, luôn gắn người gửi
từ phiên; chỉ chủ thể đọc hồ sơ của mình. SYSTEM_ADMIN và
PLATFORM_PRIVACY_OFFICER xử lý qua `/platform-privacy`; AUDITOR và các vai khác
không đọc hộp thư. Yêu cầu được xem xét, không tự xóa lịch sử truy xuất hoặc sửa
event hash. Nội dung và phản hồi lưu AES-256-GCM với AAD theo từng bản ghi;
journal chỉ giữ kết quả metadata, audit không giữ nội dung riêng tư. Ghi chú
tiếp nhận của chủ thể che danh tính ở audit chung; danh tính thật chỉ nằm trong
hồ sơ riêng tư và journal có kiểm quyền. Ghi chú
INTERNAL không trả cho người gửi; RESPONDED phải có phản hồi SHARED.

Hồ sơ BREACH có `detectedAt`, hạn cố định +72 giờ và đánh giá UNASSESSED /
REQUIRED / NOT_REQUIRED. Không thể dời đồng hồ hoặc xóa lịch sử. Đóng hồ sơ cần
căn cứ không thuộc diện báo cáo hoặc thời điểm đã thông báo kèm tham chiếu bằng
chứng; phần mềm không tự gửi báo cáo ra ngoài. Yêu cầu quyền dữ liệu thông thường
không bị gán mặc định hạn 72 giờ. Mọi ghi dùng version/idempotency và audit trong
cùng transaction; kết quả chưa rõ giữ nguyên body/key. Nội dung riêng tư không
đưa vào local storage phục hồi command; người dùng giữ tab để đối soát.

Đối chiếu ngày 18/10/2026: [NĐ 13/2023 trên VBPL](https://vbpl.vn/bocongan/Pages/vbpq-print.aspx?ItemID=161106)
là văn bản lịch sử. [Điều 42 NĐ 356/2025](https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=187276)
cho văn bản này hết hiệu lực từ 01/01/2026. Bộ đếm dựa trên thời điểm phát hiện
theo [Luật 91/2025/QH15](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/91qh.signed.pdf);
người phụ trách đánh giá điều kiện và phạm vi thông báo theo hồ sơ thực tế.
[NĐ 15/2018](https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=128513) và
[NQ 15/2026](https://chinhphu.vn/?classid=0&docid=217667&pageid=27160)
được đối chiếu riêng về an toàn thực phẩm; không dùng chúng để suy ra hạn xử lý
mọi yêu cầu dữ liệu hoặc cấp quyền thu hồi lô cho admin.

## Các vai quản trị hẹp (P2)

SYSTEM_ADMIN giữ quyền quản trị đầy đủ. PLATFORM_OPERATOR chỉ đọc bảng vận hành
và diễn tập; PLATFORM_CASE_MANAGER quản lý hồ sơ sự cố và đọc diễn tập;
PLATFORM_PRIVACY_OFFICER chỉ xử lý hộp thư quyền dữ liệu/sự cố riêng tư. Cả ba
có MFA tự phục vụ và khóa đăng nhập nền tảng, không có quyền user/org/grant/
ghi nghiệp vụ. Không tự chuyển quyền tài khoản hiện hữu.

## Hồ sơ nghiệp vụ theo biểu mẫu bổ sung (19/10/2026)

- Sản phẩm, vùng sản xuất, giống/vật tư và cơ sở mới khởi tạo ở trạng thái chưa
  hoạt động. Chỉ kích hoạt sau khi có đủ trường bắt buộc và ảnh chứng cứ hiện hành:
  sản phẩm ít nhất 1 ảnh, vùng sản xuất đủ 5 nhóm bắt buộc, giống/vật tư và cơ sở
  ít nhất 1 ảnh đúng loại. Mỗi file tối đa 5 MB; đính chính tạo bản mới, không sửa
  file hoặc trace cũ.
- Vụ sản xuất có thể lập nháp trước khi có chuỗi. Nháp giữ UUID, mã tự sinh, vùng,
  thửa, sản phẩm, ngày, diện tích, giống, người phụ trách và phương pháp canh tác;
  không có trace/Fabric stream và không được ghi nhật ký hay thu hoạch. Lệnh liên
  kết kiểm lại quyền, tư cách chuỗi và Fabric binding trong cùng transaction; cùng
  UUID trở thành vụ hoạt động. Giống và người phụ trách phải đang hoạt động trong
  doanh nghiệp tại lúc lập nháp và liên kết.
  Ảnh vụ (CYCLE_IMAGE, chứng nhận) có thể tải ở bước nháp dưới loại chứng cứ
  `CYCLE_DRAFT`; chúng chưa lên sổ cái. Lệnh liên kết ghi `EVIDENCE_ATTACHED` cho
  từng ảnh nháp ngay sau `PRODUCTION_CYCLE_CREATED`, trong cùng transaction. Tải
  ảnh nháp khóa dòng nháp để không lọt ảnh giữa lúc liên kết; sau khi liên kết,
  ảnh mới tải ở vụ. Ảnh nháp vẫn đọc được từ vụ vì cùng UUID.
- Nhật ký chăm sóc yêu cầu tên, ảnh CARE_IMAGE hiện hành và version vụ. Thu hoạch
  yêu cầu tên lô, người đại diện, ảnh HARVEST_IMAGE và LOT_IMAGE hiện hành, version
  vụ và số lượng/đơn vị hợp lệ. Mỗi lần thu hoạch tạo một lô nguồn cùng QR; ảnh
  lô được sao sang hồ sơ lô. Nếu chọn cơ sở lưu giữ ban đầu, toàn bộ lượng thu
  hoạch được ghi đồng thời vào tồn tổ chức và tồn cơ sở; không làm tăng tổng nguồn.
- Doanh nghiệp ngoài hệ thống chỉ được lưu làm danh bạ tham chiếu, không trở thành
  thành viên chuỗi, bên nhận giữ hàng hay người ký. Thành viên nội bộ có chức danh,
  liên hệ và phân công cơ sở/vùng; lời mời chuyển các trường này sang tài khoản chỉ
  sau khi được chấp nhận. Ảnh đại diện và giấy tờ thành viên là chứng cứ riêng tư.
- Người quản lý trực tiếp quyết định thành viên được làm gì và ai quản lý họ.
  Chỉ chủ quản đổi được, chỉ cho nhân viên cấp 3, sang quản lý cấp 2 đang hoạt
  động (trực thuộc chủ quản) hoặc về chủ quản. Quản lý mới phải có mọi quyền và
  phạm vi chuỗi/cơ sở của thành viên. Mỗi lần đổi ghi một dòng bất biến
  `enterprise_supervisor_change`; trigger cấp bậc chỉ nhận cập nhật đi kèm dòng đó
  trong cùng transaction. Thành viên bị thu hồi phiên và phải đăng nhập lại.
- Phiếu giao nhận mới yêu cầu giờ dự kiến lấy hàng có múi giờ; giờ giao dự kiến
  nếu có không được trước giờ lấy. Lịch và ghi chú tham gia snapshot đồng thuận
  của phiếu mới. Phiếu cũ có các cột mới `NULL` giữ snapshot/chữ ký trước đó.
  Chủ chuỗi chỉ ngừng hồ sơ nghiệp vụ khi không còn giao nhận, lượng chờ đối
  soát hay nghĩa vụ thu hồi chưa hoàn tất; lịch sử và QR cũ tiếp tục đọc được.
- Từ 2026-10-26 phiếu giao nhận có `transport_mode`: `PLATFORM_CARRIER` (đơn vị
  vận chuyển trên AgriTrace, ba bên độc lập như trước), `EXTERNAL_CARRIER` (thuê
  xe ngoài; bên thuê là bên giao hoặc bên nhận và giữ vai trò người chở),
  `SELF_DELIVERY` (bên giao tự chở) và `RECEIVER_PICKUP` (bên nhận tự lấy). Khi
  bên giao hoặc bên nhận kiêm người chở, mỗi bước chỉ cần chữ ký của các doanh
  nghiệp khác nhau tham gia bước đó (`distribution_phase_parties`); chỉ đơn vị
  vận chuyển trên AgriTrace ghi quan sát cảm biến. Thông tin xe/tài xế nhập tay
  nằm trong snapshot ký của phiếu không dùng `PLATFORM_CARRIER`; phiếu cũ giữ
  nguyên snapshot. Phiếu đi theo chuỗi của lô (không chọn chuỗi). Bên nhận hoặc
  đơn vị vận chuyển chưa ở chuỗi nhận lời mời khi phiếu được lập; chủ quản chấp
  nhận vào chuỗi trên phiếu. Nếu bên giao là chủ chuỗi, người chấp nhận được cấp
  vai trò theo năng lực doanh nghiệp; nếu không, chủ chuỗi cấp vai trò như thường.
  Chỉ ký được khi đã là thành viên hoạt động và quyền ledger đã đồng bộ. Bên nhận
  gửi được yêu cầu lấy hàng (không giữ chỗ hàng); bên giao lập phiếu
  `RECEIVER_PICKUP` từ yêu cầu hoặc từ chối.
- Phân bổ lượng chưa gắn cơ sở ghi ngay, không cần giao nhận vật lý. Chuyển hàng
  giữa hai cơ sở của cùng doanh nghiệp phải lập phiếu chuyển kho (`CK-…`): Chờ
  chuyển → Đang chuyển → Đã nhận/Chênh lệch, hoặc Hủy khi chưa xuất. Khi xuất,
  kho nguồn bị trừ; tồn tổ chức và tổng lô không đổi; lượng đang chuyển không được
  tính là "chưa phân bổ". Kho nhận chỉ cộng lượng xác nhận thực nhận. Phần thiếu ở
  trạng thái Chênh lệch, không tự coi là mất, cho đến khi được trả lại kho nguồn
  hoặc ghi hao hụt (cần `quantity.adjust`). Guard SQL hoãn kiểm: tồn các cơ sở cộng
  lượng đang chuyển/chênh lệch không vượt tồn tổ chức.
- Đưa hàng vào cách ly luôn tạo phiếu cách ly (`CL-…`) có nguyên nhân (nghi ngờ hư
  hỏng, chất lượng không đạt, chờ kiểm định, khác). Giải tỏa hoặc ghi hư hỏng phần
  cách ly phải chọn phiếu; phiếu đóng ở Đã giải tỏa hoặc Đã xử lý khi hết lượng mở.
  Lượng cách ly phát sinh từ biên bản nhận hàng không có phiếu vẫn xử lý được trong
  phần chưa có phiếu. Phiếu chuyển và phiếu cách ly bất biến, chỉ đổi trạng thái hợp
  lệ; ảnh/chứng từ gắn qua chứng cứ `SITE_TRANSFER`/`QUARANTINE`.
- Sản phẩm có thêm nguyên liệu, nhà xưởng sản xuất (cơ sở của doanh nghiệp), nhà xuất
  khẩu/nhập khẩu/phân phối/vận chuyển và người quản lí (thành viên đang hoạt động).
  Nhật ký chăm sóc ghi người thực hiện (tài khoản đang ghi hoặc người phụ trách vụ)
  và tình trạng cây trồng. Chuỗi mới có thể liên kết sản phẩm đang hoạt động của chủ
  chuỗi. Tất cả là trường không bắt buộc; bản ghi cũ giữ `NULL`/rỗng.

## Mô hình tham gia, nhà chế biến và gói dịch vụ (19/10/2026)

Kế hoạch: [admin-console-processor-plan-2026-10-19](plans/admin-console-processor-plan-2026-10-19.md).

- Năng lực tổ chức thêm `PROCESSOR`, kèm vai trò chuỗi `PROCESSOR` (migration
  `20261213000005_processor_chain_role`, quyền ledger cho `LOT`) để nhà chế biến
  ghi sự kiện phân phối/chế biến qua binding như các khâu khác. Vai trò không
  thuộc chuỗi bị từ chối 409 khi ghi ledger.
- Đăng ký chọn mô hình `SINGLE` (đúng một
  hoạt động) hoặc `SUPPLY_CHAIN_ENTERPRISE` (tổ chức có đăng ký, ít nhất hai năng
  lực). Mỗi hoạt động tạo một `capability_request`; admin duyệt/từ chối riêng.
  Đăng ký không cấp năng lực. Duyệt sau khi đã kích hoạt cấp năng lực ngay trong
  cùng lệnh có audit; trước kích hoạt thì bước kích hoạt cấp các năng lực đã duyệt.
  Hồ sơ cũ không có yêu cầu năng lực giữ hành vi cấp theo `activities`.
- Năng lực chế biến cần loại hình chế biến, số và hạn giấy chứng nhận cơ sở đủ điều
  kiện ATTP (còn hiệu lực lúc đăng ký và lúc duyệt) cùng tài liệu `CERTIFICATE`.
- Tổ chức trả phí: có năng lực `FARM` hoặc mô hình doanh nghiệp chuỗi. Chỉ họ mua
  gói, được cấp `CREATE_CHAIN` và phải có subscription `ACTIVE` trước khi kích hoạt.
  Vận chuyển, chế biến, phân phối, bán lẻ tham gia miễn phí, chỉ có `ORG_ADMIN`,
  ghi nghiệp vụ trong chuỗi được mời, theo hạn mức `billing.participantLimits`.
- Bảng giá lưu `service_plan_version`; bản đã công bố bất biến, báo giá ghi
  `planVersionId`. Chấp nhận hợp đồng tạo subscription `PENDING_PAYMENT` và hóa
  đơn `INITIAL`; thanh toán (mô phỏng local hoặc admin xác nhận chuyển khoản) đổi
  subscription sang `ACTIVE`. Hóa đơn gia hạn nối kỳ từ ngày hết hạn hiện tại.
  Hóa đơn chỉ đi `ISSUED → PAID | VOID`; mỗi mã giao dịch nhà cung cấp chỉ thanh
  toán một hóa đơn. Doanh thu mô phỏng tách riêng, không tính là tiền thật.
- Trạng thái hiệu lực suy ra từ `ends_at`: `ACTIVE`, `GRACE` trong
  `billing.graceDays` (mặc định 15 ngày), sau đó `RESTRICTED`. `GRACE` vẫn tạo mới;
  `RESTRICTED` chặn kích hoạt sản phẩm, tạo chuỗi và thêm thành viên,
  nhưng không chặn giao nhận đang dở, đọc dữ liệu hay trang QR công khai. Hạn mức
  kiểm trong cùng transaction của lệnh tạo.

## Chế biến (biến đổi lô)

- Lệnh chế biến do tổ chức có năng lực `PROCESSOR` lập tại cơ sở loại
  `PROCESSING`/`PACKING`, trong một chuỗi; quyền `processing.write` theo chuỗi và
  cơ sở. Lô đầu vào phải cùng chuỗi, cùng đơn vị cơ sở, đang được tổ chức giữ tại
  cơ sở (trừ phần giữ chỗ và cách ly), không hết hạn/thu hồi/khóa và đã đối soát.
- Cân bằng khối lượng: Σ đầu vào = Σ lượng quy đổi của thành phẩm/phụ phẩm + Σ hao
  hụt, sai lệch tối đa `processing.massBalanceTolerancePercent` (mặc định 0%). API
  và constraint trigger DB cùng kiểm.
- Lượng quy đổi do server tính, không lấy theo client. Thành phẩm cùng đơn vị cơ sở
  thì lượng quy đổi bằng lượng ghi nhận. Khác đơn vị thì bằng lượng × hệ số đã khai
  của sản phẩm (`product_unit_conversion`, quyền `catalog.manage`). Hệ số chỉ được
  khai mới hoặc thu hồi kèm lý do, không sửa. Trigger DB tính lại khi ghi dòng
  thành phẩm; lệnh nháp có hệ số đã bị thu hồi thì không hoàn tất được.
- Tổ chức chế biến đọc lô thành phẩm của mình qua `/lots`, giới hạn theo chuỗi và cơ
  sở được giao. Lineage và chi tiết lệnh không lộ tồn kho hay trạng thái lô của tổ
  chức khác. Khi hoàn tất lệnh, API kiểm tra lại năng lực `PROCESSOR` và sản phẩm
  đầu ra.
- Lệnh nháp không trừ kho. Hoàn tất trong một transaction: trừ tồn tổ chức, tồn
  cơ sở và lượng khả dụng từng lô đầu vào (`PROCESSING_OUT`, lô về 0 thành
  `CONSUMED`); tạo lô `TRANSFORMATION` cho từng đầu ra cùng QR, tồn tại cơ sở và
  `PROCESSING_IN`; ghi `DISTRIBUTION_QUANTITY_RECORDED` với `kind`
  `PROCESSING_INPUT`/`PROCESSING_OUTPUT` (giữ loại sự kiện chaincode hiện có).
  Lệnh hoàn tất hoặc hủy là bất biến; sai thì lập lệnh điều chỉnh mới.
- Lô chế biến có `origin_type = TRANSFORMATION`, `harvest_id` rỗng và
  `processing_run_id`. Chuỗi và binding sổ cái của sự kiện lấy theo
  `origin_cycle_id` của lệnh; các đầu vào không được thuộc binding khác nhau.
  Luồng gắn với vụ (shipment, kế hoạch giao hàng, chứng nhận vụ) không nhận lô
  chế biến.
- Trang QR công khai của lô chế biến hiện lô nguyên liệu, nhà sản xuất (ẩn tên
  vùng riêng tư) và tổng cân bằng; bằng chứng cảm biến là `NOT_APPLICABLE`.
  Diễn tập thu hồi và tra cứu admin lan từ lô nguyên liệu tới mọi lô thành phẩm.

### Phiếu nhập và vòng đời lệnh (27/10/2026)

Kế hoạch: [processing-receipts-lifecycle](plans/processing-receipts-lifecycle-2026-10-27.md).
Phần dưới thay các mô tả "lệnh nháp/hoàn tất" ở trên cho lệnh lập từ ngày này.

- **Phiếu nhập nguyên liệu** (`material_receipt`, không sửa/xóa):
  - Khi bên nhận xác nhận thực nhận và cơ sở nhận là loại `PROCESSING`/`PACKING`,
    hệ thống tự tạo phiếu `AGRITRACE` theo lượng thực nhận trong cùng
    transaction. Tồn vẫn tính trên tồn cơ sở của lô.
  - Phiếu `EXTERNAL` cho nguyên liệu mua ngoài: nhà cung cấp, số chứng từ, ngày
    nhập, lượng/đơn vị. Tồn tính trên chính phiếu (`quantity − reserved − consumed`).
    Phiếu chỉ dùng được khi có ít nhất một chứng từ `MATERIAL_RECEIPT` chưa rút.
- **Vòng đời lệnh:**
  - Lập kế hoạch (`DRAFT`): chọn 1 sản phẩm chính đang hoạt động và nguyên liệu
    (lô AgriTrace và/hoặc phiếu ngoài) cùng đơn vị cơ sở tại cơ sở; chưa giữ chỗ.
  - Bắt đầu (`IN_PROGRESS`): giữ chỗ toàn bộ nguyên liệu (`reserved`). Bổ sung
    nguyên liệu khi đang chế biến thì giữ chỗ ngay.
  - Hủy: được khi `DRAFT`/`IN_PROGRESS`; hủy lệnh đang chế biến trả lại phần giữ chỗ.
  - Ra lò (`COMPLETED`, một lần): ghi đúng một dòng sản phẩm chính, phụ phẩm
    (`BY_PRODUCT`) và hao hụt; kiểm cân bằng gồm cả nguyên liệu ngoài; trừ
    `quantity` và `reserved` của lô, tăng `consumed` của phiếu ngoài.
- **Nhật ký** (`processing_log`): chỉ thêm khi `IN_PROGRESS`; sai thì ghi dòng
  `CORRECTION` trỏ tới dòng cũ. Ảnh tùy chọn (`PROCESSING_LOG`/`PROCESSING_IMAGE`).
  QR công khai hiện bước, thời điểm và ghi chú, không hiện người ghi.
- **Sổ cái:** không ghi sự kiện riêng cho nhật ký hay phiếu ngoài. Sự kiện
  `PROCESSING_OUTPUT` lúc ra lò chứa `externalInputs` (nhà cung cấp, số chứng
  từ, `selfDeclared`) và `steps` (bước, thời điểm, SHA-256 ghi chú). Lệnh chỉ có
  nguyên liệu ngoài không có vụ gốc nên giữ `binding_digest` của chuỗi lúc lập;
  `TraceService` dùng binding đó cho lô thành phẩm.
  Chuỗi chưa có binding hoạt động thì không lập được lệnh chỉ dùng nguyên liệu ngoài.
- Lệnh nháp lập trước ngày này (không có sản phẩm chính) không bắt đầu được;
  hủy và lập lại.
  Diễn tập thu hồi và tra cứu admin lan từ lô nguyên liệu tới mọi lô thành phẩm.


## Khu quản trị nền tảng mở rộng

- Admin điều phối, không ghi lô/vụ/giao nhận/thu hồi thay doanh nghiệp. Các trang
  Blockchain, giám sát, thống kê, sao lưu chỉ đọc; không có nút phát lại outbox,
  sửa binding hay chạy sao lưu/khôi phục.
- Khóa QR: trang QR vẫn mở và hiện cảnh báo công khai; không in thêm tem cho lô
  bị khóa. Mở khóa cần lý do.
- Tham số nền tảng chỉ gồm danh sách cho phép (`SETTING_RULES`), có phiên bản và
  audit; secret, khóa ký, cấu hình Fabric/controller không nằm trong đó.
- Báo cáo vi phạm từ trang QR công khai: không đăng nhập, `requestId` chống gửi
  trùng, giới hạn `consumerReports.maxPerHour` theo băm có khóa của nguồn mạng (không
  lưu IP). Liên hệ chỉ lưu khi có đồng ý và chỉ nhân sự xử lý (`SYSTEM_ADMIN`,
  `PLATFORM_CASE_MANAGER`) thấy; `AUDITOR` không thấy. Khi chuyển hồ sơ sự cố, chủ lô
  nhận hồ sơ mà không kèm thông tin liên hệ.
- Hủy hóa đơn khởi tạo sẽ phát hành ngay hóa đơn thay thế theo phiên bản gói trong
  hợp đồng đã chấp nhận, và gói vẫn ở trạng thái chờ thanh toán. Khi kỳ đã trả còn
  hiệu lực, chỉ gia hạn được cùng gói; đổi sang gói khác chỉ làm được sau khi kỳ hiện
  tại kết thúc (trong thời gian ân hạn).
- Yêu cầu hỗ trợ có hạn phản hồi theo `support.reviewSlaHours` và ưu tiên; ghi chú
  nội bộ không hiện cho doanh nghiệp; yêu cầu đã đóng không nhận trả lời.
- Thông báo hệ thống chỉ là banner theo đối tượng và thời gian (tối đa 90 ngày),
  độc lập với chế độ khóa ghi của controller.

## Nhóm quyền đang dùng và ảnh sản phẩm (20/10/2026)

- Nhóm quyền đã gán cho thành viên vẫn sửa được. Quyền mới có hiệu lực ngay cho
  mọi thành viên đang hoạt động trong nhóm, không thu hồi phiên; quyền theo chuỗi
  (`scoped_role_grant` CHAIN) của từng người được cấp lại theo nhóm như khi sửa
  thành viên. Quản lý cấp 2 chỉ sửa được nhóm khi mọi người giữ nhóm đều do mình
  quản lý, và không cấp quyền vượt quyền đang có. Người quản lý cấp 2 vẫn giới hạn
  quyền thực tế của nhân viên cấp 3 theo `enterpriseAuthority`.
- Tạo thành viên bắt buộc địa chỉ liên hệ và ít nhất một nhóm quyền (API trả 400 nếu
  thiếu).
- `trace_evidence` vẫn bất biến. Gỡ ảnh sản phẩm ghi một dòng chỉ thêm vào
  `trace_evidence_withdrawal` (lý do, người gỡ); file và hash được giữ để đối soát,
  nhưng không còn trong danh sách ảnh và không được tính vào điều kiện ba ảnh. Chỉ
  gỡ được ảnh sản phẩm của chính tổ chức; sản phẩm đang hoạt động phải còn ít nhất
  một ảnh sản phẩm sau khi gỡ.
- Worker giải mã mật khẩu tạm/OTP trong hàng đợi mail bằng `JWT_SECRET`, nên Worker
  phải được cấu hình cùng giá trị với API. Lỗi gửi mail được ghi log (chỉ lý do,
  không có người nhận, mật khẩu hay OTP).

## Chuỗi riêng, nhân viên của vụ và ràng buộc diện tích (26/10/2026)

- **Chuỗi riêng.** Khi admin kích hoạt doanh nghiệp được cấp `CREATE_CHAIN` (có
  năng lực `FARM` hoặc mô hình doanh nghiệp chuỗi), cùng lệnh kích hoạt tạo một
  chuỗi `personal = true` (migration `20261215000000_personal_supply_chain`, tối
  đa một chuỗi mỗi tổ chức). Chuỗi có hồ sơ nghiệp vụ `ACTIVE`, chủ doanh nghiệp là
  thành viên, `CHAIN_MANAGER` và vai trò nghiệp vụ theo từng năng lực đã duyệt.
  Chuỗi riêng không tính vào hạn mức `chains` của gói. Binding vẫn do vận hành
  đăng ký ngoài API (xem Hybrid runbook); trước khi binding `ACTIVE`, chuỗi chưa
  nhận lệnh sản xuất. Doanh nghiệp đã kích hoạt trước đó được bổ sung bằng
  `node dist/operator/personal-chains.js`. Đối tác vào chuỗi qua phiếu giao như
  mọi chuỗi khác. Form tạo vụ ẩn ô chuỗi khi doanh nghiệp chỉ có một chuỗi và mặc
  định chọn chuỗi riêng.
- **Nhân viên của vụ.** Mỗi vụ có ít nhất một nhân viên được giao
  (`production_cycle_staff`, migration `20261216000000_production_cycle_staff`);
  người đầu tiên là người phụ trách (`responsibleUserId`). Bỏ trống thì lấy người
  phụ trách hoặc người tạo. Vụ nháp giữ danh sách trong `staff_user_ids` và chuyển
  sang vụ khi đưa vào chuỗi. Nhân viên cấp 3 chỉ thấy và ghi (xuống giống, nhật ký,
  thu hoạch, kết thúc/hủy) vụ và vụ nháp mình được giao; cấp 1 và 2 thấy mọi vụ trong
  phạm vi được giao và đổi danh sách bằng `POST /production-cycles/:id/staff`
  (`EW_SET_CYCLE_STAFF`, quyền `production.write`). Người đại diện thu hoạch và người
  thực hiện chăm sóc phải là nhân viên được giao (hoặc chính người ghi). Danh sách
  này là phân quyền vận hành, không nằm trong payload/hash sự kiện ledger.
- **Diện tích.** Thửa đất mới ghi đơn vị `m2` hoặc `ha` (mặc định `m2`); tổng diện
  tích các thửa đang hoạt động không vượt `areaM2` của vùng. Diện tích canh tác
  của vụ (m²) không vượt diện tích thửa, hoặc diện tích vùng khi vụ không chọn thửa.
  Thửa cũ ghi đơn vị tự do không bị kiểm.
- **Hồ sơ vùng sản xuất.** Vùng chỉ cần ảnh giấy quyền sử dụng đất
  (`LAND_CERTIFICATE`); các loại ảnh vùng, hợp đồng sản xuất, chứng nhận chất
  lượng và ảnh kiểm tra đã bỏ và không tải thêm được (chỉ còn `OTHER` dùng chung).
  Form thêm vùng bắt buộc chọn ảnh này, tải lên và hoàn tất hồ sơ ngay sau khi tạo.
- **Đơn vị thu hoạch.** Form thu hoạch khóa đơn vị theo kế hoạch của vụ vì API
  bắt buộc trùng; form tạo vụ lấy đơn vị mặc định của sản phẩm.
- **Gỡ in tem QR, thêm Kho QR.** Lệnh in `EW_QR_PRINT` và API lịch sử in đã gỡ;
  hạn mức `qrLabels` không còn trong gói (phiên bản giá cũ còn khóa này thì bị bỏ
  qua); bảng `trace_label_print` giữ làm lịch sử. Trang **Kho QR**
  (`/enterprise/qr`, `GET /distribution/qr`, quyền `qr.manage` "Xem kho QR") liệt
  kê mã QR truy xuất của các lô doanh nghiệp đang giữ hoặc đã sản xuất, trạng thái
  (hoạt động, bị khóa, có thông báo), cho xem, chép liên kết và tải mã SVG. Kho QR
  chỉ đọc; mã QR vẫn sinh cùng lô.
- **Danh mục mẫu thay ô nhập tay.** Đơn vị tính, nhóm sản phẩm/loại hình vùng, loại
  chứng nhận và loại xe chọn từ danh mục mẫu do admin quản lý (`reference_item`;
  migration `20261217000000_reference_vehicle_units` thêm `VEHICLE_TYPE` và một số
  đơn vị). Đơn vị lưu theo ký hiệu (`kg`, `tấn`…), các danh mục khác lưu theo nhãn.
  Giá trị đã lưu trước đó không có trong danh mục vẫn hiện để chọn lại khi sửa.
  API chưa ràng buộc giá trị theo danh mục (nhập CSV và tích hợp cũ vẫn chạy).


## Tài khoản trên hai app mobile (26/10/2026)

- **ACheck (người tiêu dùng):** role CONSUMER, không thuộc tổ chức, đăng nhập bằng
  `login_phone` đã xác minh OTP. Không có quyền nghiệp vụ: JWT guard trả 403 ở mọi
  route nội bộ trừ `/consumer/me`. Quét QR, danh bạ, bảng tin, thông báo và thời tiết
  là API công khai, không cần tài khoản. Lịch sử quét lưu trên máy, không có API ghi.
  API công khai chỉ hiện tổ chức ACTIVE và sản phẩm có ít nhất một lô đã có QR; không
  trả email, mã số thuế, chế độ hosting, dữ liệu kết nối Fabric hay người dùng.
- **App nhân viên:** cùng tài khoản doanh nghiệp với Web, phiên native riêng
  (`/auth/staff/*`). Không tạo quyền mới: mọi thao tác đi qua controller nghiệp vụ
  hiện có, cùng membership, grant, assignment, phạm vi nhân viên của vụ và
  idempotency. Tra lô theo QR chỉ trả lô trong phạm vi đọc của người gọi.
- Cả hai cờ đăng nhập (`CONSUMER_AUTH_ENABLED`, `STAFF_APP_AUTH_ENABLED`) mặc định tắt.

### Trạng thái có mặt trên thị trường của sản phẩm

Danh mục công khai hiển thị `Đang bán` khi ít nhất một lô hợp lệ của sản phẩm
còn lượng có thể bán tại một nhà bán lẻ đang hoạt động. Tồn phân phối dùng
`quantity - reserved - quarantined` tại địa điểm; khi đã có LotHolding thì
không quay về số dư legacy để suy ra còn hàng. Luồng shipment legacy cần lô
FOR_SALE, chuyến DELIVERED và availableQuantity > 0. Giao nhận mới đề xuất hoặc
đang vận chuyển không làm sản phẩm thành đang bán. Lô thu hồi, hết hạn, hỏng,
bị từ chối, đã tiêu thụ hoặc đã bán hết không đủ điều kiện. Hạn dùng theo ngày
Việt Nam. Nếu không có nhà bán lẻ đáp ứng, hiển thị `Chưa bán`.
Trạng thái sản phẩm tổng hợp không thay cảnh báo riêng của từng lô.
