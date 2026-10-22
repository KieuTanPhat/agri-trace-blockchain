# AgriTrace Ledger UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. **Native was explicitly selected by the user.** Do not replace it with subagent-per-task execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every visible AgriTrace frontend renderer with the UI/UX of the selected Claude preview, keep every baseline business function and URL, and upgrade the web workspace to Next.js 16.

**Architecture:** Backend/API and headless frontend logic come only from the fetched `feature/admin-console-processor` baseline. Presentation comes only from a frozen snapshot of `agritrace-admin-preview`; missing screens are newly composed from its Ledger components. Existing route files become thin async wrappers around new screen modules, and all legacy renderers/styles are removed before final acceptance.

**Tech Stack:** Next.js **16.4.2**, React/React DOM **19.3.0**, TypeScript, Tailwind CSS 4 via PostCSS, Radix/shadcn UI from the preview, React Hook Form + Zod, TanStack Query 5, existing Vitest and Playwright; unchanged NestJS/PostgreSQL/Fabric backend.

**Spec:** [2026-10-22-ledger-ui-migration-design.md](../specs/2026-10-22-ledger-ui-migration-design.md). Read it with [the route/provenance inventory](../specs/2026-10-22-ledger-ui-migration.inventory.json). The spec is the authority; this plan describes its implementation.

## Global Constraints

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

## Review Focus

- **RF1 — legacy UI hidden by aliases, transitive imports, copied files or CSS-only restyling:** no legacy renderer/layout/style may survive or be used as a design reference; pin with Task 1 provenance tests, Task 3 source comparison, and Task 18 final audit.
- **RF2 — preview/baseline contract mismatch:** approval, settlement, activation, envelope and permissions must follow the baseline rather than newer preview mock assumptions; pin with Tasks 4, 6 and 12.
- **RF3 — identity/locale/tab changes while private data is cached:** never flash another user's/organization's data or reset a pending command; pin with Tasks 3–5.
- **RF4 — lost response, reload, duplicate click or second-tab retry:** preserve exact body/key/signature and reconcile; pin with Tasks 5, 13 and 15.
- **RF5 — untrusted uploads, QR input or signed payload:** preserve file privacy/validation, same-origin navigation and content-bound signatures; pin with Tasks 10–11, 13 and 17.

---

## Read this before Task 1

### Confirmed state and safe starting point

- Planning checkout: `C:/Users/kieup/Desktop/agri-trace-blockchain`, branch `feature/enterprise-registration-plans`, head `61fcbb3`. **Do not start the product migration on this checkout and do not fix its Studio Admin UI as part of this work.**
- GitHub source branch was confirmed at `e1415e91eaaa96aab7b12f9cb972b109296b5720` on 22/10/2026. There are **143 page routes** in the stored inventory. Fetch again at execution time.
- UI source: `C:/Users/kieup/Desktop/Fe-clone-Agritrace/agritrace-admin-preview`. The refreshed inventory has **127 presentation/design inputs**, including page layouts, shared components, assets and display helpers, plus unfinished mock resources. Hash inventory includes preview-only presentation for audit; `uiSource.excludedFromRuntime` must never be copied into production. Do not treat preview mock typecheck status as a prerequisite or its state machine as truth.
- Wrong UI sources: the underscore project `FE-Clone_Agritrace`, sibling `agritrace-ui-preview`, worktree `agri-trace-admin-ui`, and commit `61fcbb3`. Do not read their UI into this task.
- Exact task-owned route paths and target screen paths are in the JSON inventory; each task selects its assigned rows. If the source SHA changes, regenerate metadata and update the affected tasks before claiming coverage; do not silently keep the old count.

### Preview refresh incorporated on 22/10/2026

The source refresh updates 8 existing hashes and adds 19 inputs: 11 workspace pages, 5 shared workspace components, and 3 display helpers. Products, areas, materials, profile, chains, cycles, lots, inventory, distribution, processing and enterprise QR now have preview screens to start from. Do not treat these screens as missing or recreate their layout from scratch. Only missing baseline workflows/subroutes are newly composed from Ledger.

`uiSource.taskReferences` supplies exact source paths for all 18 tasks; resolve its `includeInventoriedPrefixes` only against the inventoried file list. `uiSource.discovery` defines what Task 1 must rescan for later additions, including ignored presentation files. The 143 baseline routes, business contracts, Native method and zero-legacy-UI requirement are unchanged. New preview API/mock modules do not expand backend scope or replace baseline DTOs, permissions, validation, signatures or recovery.

Shared target ownership follows execution order: Task 9 ports evidence/revision/gallery components used by profile and later domains; Task 12 ports partner-profile; Task 15 ports lineage-panel before Task 16 consumes it. Source paths may be referenced by several tasks, but a shared target module has one creating task.

### Superpowers workflow and context efficiency

1. Read `using-superpowers`, this plan and its spec once; use `using-git-worktrees` to create/verify the isolated checkout, then execute with `executing-plans`.
2. Use the plan-specific ignored workspace/ledger created by the executing-plans helper. First line identifies this exact plan. Record completed task IDs, commits, test results, and rulings. Check it and Git after compaction; **do not redo completed work**.
3. Read only the current task's relevant skill and source ranges. Use CodeGraph first when that checkout has an index; do not initialize an index or re-read entire docs for each file.
4. Use `test-driven-development` for meaningful behavior changes. Use `systematic-debugging` on failures before guessing a fix. Use `verification-before-completion` before task/branch success claims and commits.
5. Execute sequentially with **one writer**. No implementer/reviewer agent per task in Native. At Task 18 use `requesting-code-review` and one fresh `agritrace-reviewer` for the branch; then `receiving-code-review` for actionable findings.
6. Reviewer gets spec, exact base/head, changed files, new UI source and evidence. UI reference images are from the frozen preview only. Do not put legacy JSX/CSS/screenshots into the review/design context. Compare business/headless diffs normally.
7. Use `finishing-a-development-branch` only after required gates; final disposition is **keep local branch and worktree for review**, with no push/PR/merge/deploy.
8. Honor repo domain skills: frontend; API contract for consumer compatibility; Hybrid for auth/recovery/signatures/trace. Do not invoke DB/release work or fabricate acceptance.
9. Write test/build output to a local log; print the exit code and at most the relevant first 40–60 failures, or the final 15 summary lines. One local heavy job at a time; no repeated green suites unless a new change/failure justifies them.

### File structure and ownership

| Boundary | Files / responsibility |
|---|---|
| Approved requirements | This plan, design spec and inventory under `docs/superpowers/`; copy these three documents into the new worktree before implementation because they may still be uncommitted in the planning checkout |
| Mechanical audit and gates | `scripts/ledger/audit-baseline.mjs`, `check-ui-origin.mjs`, `check-change-scope.mjs` and their Node tests; no product behavior |
| Per-route/action contract | `apps/web/ledger-migration.matrix.json`; exact URLs, ownership, role/scope, endpoint/action, implementation and tests |
| Next 16 routing contract | `apps/web/src/lib/ledger/route-input.ts`; async params/query input only |
| Shared new presentation | `apps/web/src/components/ledger/{ui,kit,shell,workspace}/`; `brand.tsx`, `locale.tsx`, `providers.tsx`, `confirm-provider.tsx`; imports originate from the preview or new Ledger-only implementations |
| New shared runtime glue | `apps/web/src/lib/ledger/{request,query-scope,navigation}.ts`; typed delegation to baseline transport/auth, scope-aware caching, and preview-style navigation |
| Locale/format | `apps/web/src/lib/ledger/{i18n,i18n-en,format,labels,utils}.ts`; port display helpers from preview; `ops-labels.ts` and `use-now.ts` join in Task 14. Baseline defines enum/quantity/time-dependent business rules |
| Feature screens | `apps/web/src/features/ledger/screens/<existing-app-relative-directory>/screen.tsx`; supporting `fields.ts`, `hooks.ts`, `schema.ts` colocated only when needed; one workflow per module, no giant generic backend dashboard |
| Route wrapper | Existing `apps/web/src/app/**/page.tsx` path, URL and query semantics retained; imports its paired new screen and resolves async route input |
| Browser contract fixtures | `apps/web/tests/ledger/{fixtures.ts,fixtures/*.ts,*.spec.ts}`, `apps/web/playwright.ledger.config.ts`; fixtures cannot be imported by runtime code |
| Live evidence | Existing isolated harness in `scripts/ci/`; update UI selectors/interaction steps only, preserve business/crypto assertions |
| Local only | Plan-specific `.superpowers` scratch, source snapshots, screenshots/logs/traces; ignored and excluded from Docker context |

**Legacy logic allowance:** Keep baseline `api-client.ts`, `auth-coordination.ts`, `auth-scope.ts`, `enterprise-access.ts`, `command-request.ts`, `command-recovery.ts`, harvest recovery, generated types, QR parsing and signing modules. A renderer located under `src/lib` is still legacy UI and must be replaced. Old navigation groupings, `lib/confirm.tsx` renderer, appearance palettes and typography styles are not part of this allowance.

### Shared interfaces fixed by this plan

```ts
// src/lib/ledger/route-input.ts — Task 2
export type LedgerRouteInput = Readonly<{
  params: Readonly<Record<string, string | string[]>>;
  searchParams: Readonly<Record<string, string | string[] | undefined>>;
}>;
export type LedgerScreenProps = { route: LedgerRouteInput };
export function resolveLedgerRouteInput(input: {
  params?: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<LedgerRouteInput>;

// src/lib/ledger/request.ts — Task 4; delegate, don't create a second client
export function ledgerRequest<T>(
  path: string, init?: RequestInit,
  authenticated?: boolean, canRefresh?: boolean
): Promise<T>;
// Same defaults and behavior as baseline request<T>.

// src/lib/ledger/query-scope.ts — Task 3
export function ledgerQueryKey(
  user: Parameters<typeof import("../auth-scope").getAuthorizationScope>[0],
  suffix: readonly unknown[]
): readonly unknown[];

// Task 3 presentation exports; Task 4 completes real auth wiring.
export function LedgerProviders(props: { children: React.ReactNode }): React.JSX.Element;
export function LedgerAppShell(props: { children: React.ReactNode }): React.JSX.Element;
export function LedgerPublicShell(props: { children: React.ReactNode }): React.JSX.Element;

// New screen at every paired path below.
export default function LedgerScreen(props: LedgerScreenProps): React.JSX.Element;
```

- Keep original preview `CommandDialog/CommandForm` presentation props in the new kit. Task 5 changes only internal auth/transport/recovery orchestration to baseline semantics and supplies real endpoint callbacks.
- Canonical route wrappers await `params/searchParams`, call `resolveLedgerRouteInput`, and render their new screen. They contain no old markup, navigation or styling.
- Wrapper example for `apps/web/src/app/admin/users/page.tsx` (substitute only the inventory's paired screen import):

```tsx
import LedgerScreen from "@/features/ledger/screens/admin/users/screen";
import { resolveLedgerRouteInput } from "@/lib/ledger/route-input";

export default async function Page(
  props: Parameters<typeof resolveLedgerRouteInput>[0]
) {
  return <LedgerScreen route={await resolveLedgerRouteInput(props)} />;
}
```

- Preserve non-visual route metadata, access, cache and redirect semantics from the baseline. Remove old visible markup from nested layouts too; a thin page wrapper must not inherit a legacy shell.
- Query keys begin with `["ledger", getAuthorizationScope(user), ...suffix]`. Locale change must not create a second session or new pending command identity.
- Stable test IDs for state only: `ledger-private-root`, `ledger-command-pending`, `ledger-trace-warning-recall`, `ledger-trace-warning-expiry`, `ledger-trace-warning-integrity`. Use accessible roles/labels for interactions.

### Browser fixture interface (Task 4 produces it)

```ts
// tests/ledger/fixtures.ts; import { test, expect } from "./fixtures" in specs.
// test extends playwright/test with fixture named api.
export type ActorKey =
  | "anonymous" | "platform-admin" | "auditor" | "platform-operator"
  | "case-manager" | "privacy-officer" | "org-owner" | "org-manager"
  | "org-staff" | "processor" | "transporter" | "distributor"
  | "retailer" | "compliance-reviewer";
export type CapturedRequest = Readonly<{
  method: string; path: string; body: string | null;
  idempotencyKey: string | null;
}>;
export interface LedgerApiFixture {
  useActor(actor: ActorKey): Promise<void>;
  scenario(id: string): Promise<void>;
  requests(): readonly CapturedRequest[];
}
```

`useActor` returns typed auth/refresh/me responses through browser interception; it never writes fake roles into product storage. `scenario` selects a named typed test scenario supplied by the owning fixture file and checks expected method, baseline path/query and payload before responding; unknown scenario or unhandled API request fails the test. `CapturedRequest.path` is normalized to the baseline API-relative path (with query), so `/catalog/products` does not depend on the proxy prefix. Fixture IDs and tests below are fixed. `contract` browser project uses no real backend writes. Live verification uses the repo's isolated harness separately.

## Task dependency map

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18`.

Tasks 6–17 share foundations but own disjoint canonical routes. Do not fan them out in the same checkout. If a task has several related flows, apply RED→GREEN to each flow and commit a passing flow instead of accumulating a huge untested patch.

## Shared task contracts

- **Domain execution:** For Tasks 6–17, select this task's `routes` rows and `uiSource.taskReferences` entry from inventory. Each route row supplies literal `sourceFile` and `targetScreen`; each source reference supplies the preview path. Port existing preview screen structure, tabs, drawers, forms and states before composing missing baseline workflows. A preview drawer may supply the presentation for a required canonical detail/new URL; keep the baseline URL and deep-link semantics. Use Task 2 wrappers and baseline APIs/types/permissions/version. Preserve every matrix action, including filters, pagination, exports and failure states. Do not carry preview-only actions/endpoints or runtime mocks into the result.
- **TDD:** Tests below pin essential behavior; implement the other cases named in the task/matrix too. Observe RED for the intended behavior, implement minimally, then GREEN. Setup/syntax/service failures are not a valid RED. Never import fixtures into runtime or weaken baseline assertions. For mechanical copying/styles use provenance, screenshots and existing behavior checks rather than tests that mirror CSS.
- **Commit:** Stage only task Files/matrix changes; inspect diff and whitespace; use the given message. Record SHA/tests/limits in the ignored ledger, then mark complete. No secrets, evidence or scratch. Whole-branch acceptance is Task 18, not a green intermediate subset.
- **Fixtures:** Scenarios use baseline DTOs/service fixtures and specify request and outcome. A domain's test-only fill helper contains interactions, not hidden assertions; its name/signature is declared in its task. No fictitious endpoint or fake runtime success.
- **Negative assertions:** First establish the expected loaded screen or explicit access-denied state and at least one permitted control/record. A blank/loading page, a never-loaded sentinel, or a response fixture that ignores its expected scope/query is not evidence of correct authorization. For pending/reconcile assertions, wait for the terminal outcome before comparing requests.
- **Context:** Read plan/spec once. Parse inventory metadata, the **current task's route rows and UI source references** only; fetch corresponding hash entries on demand. After compaction read ledger/Git before doing more work. Rediscover/review changed sources before freezing, then use that frozen version for this execution rather than chasing live preview edits mid-task.

## Implementation tasks

### Task 1: Pin baseline and create enforceable route/UI provenance contracts

**Files:**
- Create: `scripts/ledger/audit-baseline.mjs`, `scripts/ledger/check-ui-origin.mjs`, `scripts/ledger/check-change-scope.mjs`.
- Test: `scripts/ledger/audit-baseline.test.mjs`, `scripts/ledger/check-ui-origin.test.mjs`, `scripts/ledger/check-change-scope.test.mjs`.
- Create: `apps/web/ledger-migration.matrix.json` from the approved inventory.
- Copy: this plan, design spec and inventory into the isolated worktree; update generic scratch ignore rules only if needed.

**Interfaces:**
- Consumes: approved JSON inventory, fetched baseline SHA, source preview snapshot.
- Produces: `checkUiOrigin({repoRoot, inventoryPath, phase: "migration" | "final"}): {errors: {code: string; file: string; detail: string}[]}` exported from `check-ui-origin.mjs`; CLI exit 1 on violations, 0 on none.
- Produces: `checkChangeScope({repoRoot, baseSha}): {violations: string[]}`; compares committed plus uncommitted paths.
- Produces: `auditPreviewInputs({sourceRoot, inventory}): {added: string[]; changed: string[]; missing: string[]}` from `audit-baseline.mjs`; discover paths using `uiSource.discovery`, hash only permitted files, and return metadata without printing source. CLI `node scripts/ledger/audit-baseline.mjs --preview <source-root> --inventory <inventory-path> --check` exits 1 on any unreviewed delta, 0 when synchronized. Once frozen, provenance/visual checks use the frozen source root and its inventory, not a later live edit.
- Produces: route matrix rows with exact spec fields; all current baseline routes assigned to one task, with `exampleUrl`, `actorKey`, `scenarioId` and `readyHeading` for browser coverage; all user-visible actions mapped to source contract/headless helper. Static/legal pages still have a tested view action. `exampleUrl` resolves dynamic segments with that scenario's valid IDs/tokens; `readyHeading` is the exact visible heading of its Ledger screen.
- Test-only helper in `check-ui-origin.test.mjs`: `makeUiOriginFixture({legacyImport?: string, via?: string, copiedLegacy?: boolean}): {repoRoot: string; inventoryPath: string}`; creates synthetic temporary files, not copied legacy UI.

- [ ] **Step 1: Write the failing test(s).** RF1: pin indirect legacy import, renamed unchanged renderer, CSS fallback and cross-subsystem mutation failures. In `audit-baseline.test.mjs`, use synthetic temporary preview inputs to pin detection of added pages/components (including ignored files), changed hashes, missing files and exclusion of secrets/dependencies/build/test output. Rehashing only previously known files must fail the added-page case. Metadata/AST audit must never print old render code.

```ts
const fx = makeUiOriginFixture({
  legacyImport: "src/components/legacy-panel.tsx", via: "src/lib/helper.ts"
});
assert.ok(checkUiOrigin({ ...fx, phase: "final" }).errors
  .some(e => e.code === "LEGACY_UI_IMPORT"));
assert.ok(checkUiOrigin({
  ...makeUiOriginFixture({ copiedLegacy: true }), phase: "final"
}).errors.some(e => e.code === "LEGACY_UI_COPY"));
```

- [ ] **Step 2: Run RED.** Run `node --test scripts/ledger/audit-baseline.test.mjs scripts/ledger/check-ui-origin.test.mjs scripts/ledger/check-change-scope.test.mjs`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** First use the worktree skill, fetch origin and create the new branch/worktree without resetting any existing work. Copy the three approved documents. Rediscover current presentation paths and approved display helpers using `uiSource.discovery`, then detect added/changed/missing inputs; do not merely rehash the old file list. Inspect only the delta, update hashes and affected `taskReferences`, and record the source version before freezing in ignored scratch. Preserve the current shared-target ownership order. Never copy secrets, dependencies or build output. Audit routes and baseline business actions using backend/Swagger/headless helpers and render-stripped AST metadata where needed. The origin checker follows imports/re-exports/dynamic imports and CSS references, checks baseline blob identities even after renaming, and rejects runtime imports of preview mock/dev tools. A primitive identical in both projects is allowed only from the approved frozen preview path/hash, with recorded provenance and no surviving legacy import/path; test this legitimate case too. `legacyUi` is a candidate denylist: AST-proven non-rendering infrastructure may move to `retainedHeadless` with its source-backed reason; no visible renderer, style, navigation or appearance token may be exempted. During migration inspect new Ledger entries; final mode inspects all route entries, nested layouts and removed legacy paths. The scope checker permits apps/web, scoped root lock/ignore changes, docs/frontend.md, docs/superpowers, scripts/ledger and UI-interaction-only browser harness changes; protects API, generated contract, DB/Fabric/Worker/deploy. Do not read legacy visuals for design. Run and record baseline checks once.
- [ ] **Step 4: Run GREEN.** Run `node --test scripts/ledger/audit-baseline.test.mjs scripts/ledger/check-ui-origin.test.mjs scripts/ledger/check-change-scope.test.mjs`. Expected: exit 0 and all named assertions pass. Run the preview audit CLI in `--check` mode against the refreshed source/inventory before freezing. Verify every current preview input has a reviewed classification/source reference and every stored baseline route has one owner and action matrix entry. If remote SHA moved, regenerate baseline metadata and log the delta before continuing.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "test(web): define Ledger migration coverage and UI provenance gates"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 2: Upgrade web runtime to Next 16 and define async routing

**Files:**
- Modify: `apps/web/package.json`, `package-lock.json`, `apps/web/next.config.ts`, `apps/web/scripts/run-next.mjs`, `apps/web/Dockerfile`.
- Create: `apps/web/postcss.config.mjs`, `apps/web/src/lib/ledger/route-input.ts`.
- Test: `apps/web/src/lib/ledger/route-input.spec.ts`, `apps/web/scripts/runtime-contract.test.mjs`.

**Interfaces:**
- Consumes: baseline deployment/build contract and preview package versions.
- Produces: exact LedgerRouteInput/LedgerScreenProps/resolveLedgerRouteInput interfaces above; native Next 16 dev/build with standalone output and production mock guard.

- [ ] **Step 1: Write the failing test(s).** Pin async params/search query preservation and mock-guard compatibility for all known flags; assert package versions and no forced Next 15 WASM.

```ts
expect(await resolveLedgerRouteInput({
  params: Promise.resolve({ id: "record-1" }),
  searchParams: Promise.resolve({ q: "xoài", page: "2", tag: ["a", "b"] })
})).toEqual({
  params: { id: "record-1" },
  searchParams: { q: "xoài", page: "2", tag: ["a", "b"] }
});
// runtime-contract.test.mjs: build rejects NEXT_PUBLIC_MOCK_API=true,
// NEXT_PUBLIC_USE_MOCK_API=true, and NEXT_PUBLIC_API_MODE=mock.
```

- [ ] **Step 2: Run RED.** Run `npm test --workspace apps/web -- src/lib/ledger/route-input.spec.ts --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Pin Next 16.4.2 and React/react-dom 19.3.0, align React types, port required preview UI libraries, and use Tailwind 4 PostCSS with native SWC/Turbopack. Remove forced @next/swc-wasm-nodejs 15/NEXT_TEST_WASM_DIR. Keep Node/npm floors and security overrides. Implement async route input and update only framework plumbing. Preserve Docker standalone API URL/proxy/image behavior. Do not spend effort repairing an old visual component that will be removed; do not run old UI as a reference or disable build/type checks. No backend dependency/version bump.
- [ ] **Step 4: Run GREEN.** Run `npm test --workspace apps/web -- src/lib/ledger/route-input.spec.ts --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run node --test apps/web/scripts/runtime-contract.test.mjs and record framework compatibility output. Full application build remains a final acceptance gate after route conversion.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "build(web): upgrade Ledger migration foundation to Next 16"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 3: Port Ledger-only presentation, shell and scope-aware providers

**Files:**
- Create: `apps/web/src/components/ledger/ui/`, `kit/`, `shell/`, `workspace/`, `brand.tsx`, `locale.tsx`, `providers.tsx`, `confirm-provider.tsx`.
- Create: `apps/web/src/lib/ledger/query-scope.ts`, `navigation.ts`, `i18n.ts`, `i18n-en.ts`, `format.ts`, `labels.ts`, `utils.ts`.
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`; port approved preview brand/font/icon assets to web public/app locations.
- Create: `apps/web/src/test/ledger-actors.ts`; export typed `actorA` and `actorB` fixture sessions, with distinct user/organization IDs, using baseline LoginResponse.
- Test: `apps/web/src/lib/ledger/query-scope.spec.ts`, `apps/web/src/components/ledger/providers.spec.tsx`.

**Interfaces:**
- Consumes: route matrix, preview snapshot components/kit/shell/styles, baseline getAuthorizationScope and headless contexts.
- Produces: LedgerProviders/LedgerAppShell/LedgerPublicShell and ledgerQueryKey signatures above; new navigation with preview groupings and baseline hrefs; copied preview CommandDialog/Form presentation API for Task 5.
- Confirmation export: useLedgerConfirm(): (input: {title: string; description?: string; confirmLabel?: string; danger?: boolean}) => Promise<boolean>; exactly one confirmation, rendered with Ledger Dialog.

- [ ] **Step 1: Write the failing test(s).** RF1/RF3: distinct organization/account scopes cannot share cache, providers remove stale private data, and new presentation imports no legacy renderer. Use existing session type fixtures, not copied UI.

```ts
expect(ledgerQueryKey(actorA.user, ["products"])).toEqual([
  "ledger", getAuthorizationScope(actorA.user), "products"
]);
expect(ledgerQueryKey(actorA.user, ["products"]))
  .not.toEqual(ledgerQueryKey(actorB.user, ["products"]));
```

- [ ] **Step 2: Run RED.** Run `npm test --workspace apps/web -- src/lib/ledger/query-scope.spec.ts src/components/ledger/providers.spec.tsx --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Copy presentation files from the frozen preview into the new Ledger namespace and rewrite imports to that namespace. Use the refreshed globals.css, workspace shell and English catalog, plus the preview's display-only utils; do not import preview workspace/auth context. Keep exact Ledger fonts/tokens/spacing/responsive and brand assets; use real baseline identity and permission data instead of preview fake grants. Rebuild root layout and shells using only new Ledger imports. Navigation grouping/visual hierarchy comes from preview; permission predicates come from baseline backend/headless policy. New route screens never import old AppFrame/old navigation/styles. Do not preserve an old DOM tree underneath a new shell. Wire cache cleanup to baseline session/scope/permission changes; changing locale keeps auth and pending command identity.
- [ ] **Step 4: Run GREEN.** Run `npm test --workspace apps/web -- src/lib/ledger/query-scope.spec.ts src/components/ledger/providers.spec.tsx --reporter=dot`. Expected: exit 0 and all named assertions pass. Run provenance migration mode for new imports. Compare selected shell/kit states against frozen preview screenshots, never legacy screenshots.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): introduce preview-sourced Ledger presentation"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 4: Connect real auth and establish browser contract fixtures

**Files:**
- Create: `apps/web/src/lib/ledger/request.ts`, `apps/web/src/lib/ledger/request.spec.ts`.
- Create: `apps/web/playwright.ledger.config.ts`, `apps/web/tests/ledger/fixtures.ts`, `fixtures/auth.ts`, `auth.spec.ts`.
- Complete real baseline auth integration in `apps/web/src/components/ledger/providers.tsx`; preserve baseline transport/session helpers.
- Modify/Create: the **4 exact route/screen pairs** where `inventory.routes[].task === 4`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: Tasks 1–3; baseline request<T>, login/restoreSession/clearSession/auth-store and enterprise-access contracts.
- Produces: ledgerRequest<T> exact delegation and LedgerApiFixture/ActorKey/CapturedRequest interfaces above; fixture named api and exported test/expect for later specs. Auth scenarios include auth.anonymous, auth.mfa-required, auth.expired-password, auth.organization-switch.
- Produces default LedgerScreen at every route pair below; signup fields/OTP/temporary-password flow and invitation semantics come from baseline DTO/service.

- [ ] **Step 1: Write the failing test(s).** RF2/RF3: use the real frontend client against intercepted auth/refresh/me endpoints; reject fake preview-role restrictions and ensure logout/account changes clear private content.

```ts
test("expired password gates business access", async ({ page, api }) => {
  await api.useActor("org-owner");
  await api.scenario("auth.expired-password");
  await page.goto("/enterprise");
  await expect(page).toHaveURL(/\/account\/password/);
  await expect(page.getByRole("heading", { name: /Đổi mật khẩu/ })).toBeVisible();
});
test("anonymous access stays at login", async ({ page, api }) => {
  await api.useActor("anonymous");
  await api.scenario("auth.anonymous");
  await page.goto("/admin/enterprises");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("ledger-private-root")).toHaveCount(0);
});
```

- [ ] **Step 2: Run RED.** Run `npm test --workspace apps/web -- src/lib/ledger/request.spec.ts --reporter=dot`, then `npx playwright test --config apps/web/playwright.ledger.config.ts auth.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Delegate ledgerRequest to baseline request without double-unwrapping envelopes, changing session storage policy, or adding a second refresh/recovery engine. Build contract fixtures from baseline DTO/generated types and service/test fixtures; fail unhandled requests and unknown scenario names. Use browser interception rather than runtime mock imports. Configure contract project at isolated local origin (default port 3300), 1440x900 default viewport and artifacts in an ignored output folder. In auth screens use Ledger UI; preserve OTP, credentials delivery, password reset/age, invitation token privacy, role access and first-login behavior. Never restrict login to only the five preview platform roles.
- [ ] **Step 4: Run GREEN.** Run `npm test --workspace apps/web -- src/lib/ledger/request.spec.ts --reporter=dot`. Expected: exit 0 and all named assertions pass. Run npx playwright test --config apps/web/playwright.ledger.config.ts auth.spec.ts --project=contract --reporter=dot. Cover login_requires_mfa, wrong_mfa_keeps_login, otp_expiry_preserves_registration, invitation_activation, one_refresh_for_concurrent_401, logout_clears_scope and identity_change_removes_cached_record with their own RED/GREEN cycles. At this task, auth gate browser tests must complete before an unmigrated private screen renders; exercise private cache transitions in `providers.spec.tsx` using a test-only child, then add browser identity-switch coverage in Task 9. Render/cache actor A's private record first, trigger the baseline session-change protocol for actor B, then assert A disappears before B loads; a never-rendered sentinel is not evidence.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): connect Ledger auth to baseline session contracts"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 5: Use baseline command/recovery behind Ledger dialogs

**Files:**
- Modify: `apps/web/src/components/ledger/kit/command-dialog.tsx`, `confirm-provider.tsx`.
- Create: `apps/web/src/components/ledger/kit/command-dialog.spec.tsx`.
- Retain and exercise: baseline `api-client.ts`, `command-request.ts`, `command-recovery.ts` and their existing tests; no second recovery store.

**Interfaces:**
- Consumes: preview CommandDialog/Form props, ledgerRequest, baseline listPendingCommands()/retryPendingCommand(id), original SavedCommand fields {path, method, body, key} and baseline MFA/approval semantics.
- Test-only in `command-dialog.spec.tsx`: `renderCommandScenario(outcome: "committed-response-lost"): Promise<{ requests: CapturedRequest[] }>`; render the Ledger form with a valid product DTO fixture and baseline transport/recovery, simulating a lost committed response plus pending status inspection. No runtime test route.
- Produces: unchanged presentation props with real transport, one confirmation, validation-preserving form state, pending/reconcile controls and exact retry identity. Pending UI exposes ledger-command-pending test ID.

- [ ] **Step 1: Write the failing test(s).** RF3/RF4: lost success response freezes the submitted command; locale/tab/reload changes do not create a new body/key; retry reconciles instead of issuing a duplicate action.

```ts
const { requests } = await renderCommandScenario("committed-response-lost");
fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
await screen.findByTestId("ledger-command-pending");
expect(screen.getByLabelText("Tên sản phẩm")).toBeDisabled();
const sent = requests.filter(r => r.method === "POST" && r.path === "/catalog/products");
expect(sent).toHaveLength(1);
fireEvent.click(screen.getByRole("button", { name: "Đối soát" }));
await waitFor(() => expect(
  screen.queryByTestId("ledger-command-pending")
).not.toBeInTheDocument());
expect(requests.filter(r => r.method === "POST" && r.path === "/catalog/products"))
  .toEqual(sent);
```

- [ ] **Step 2: Run RED.** Run `npm test --workspace apps/web -- src/components/ledger/kit/command-dialog.spec.tsx --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Keep Ledger form/dialog renderers, replace preview ApiError/token/key retry assumptions with baseline errors and command APIs. Generate a key for a new command only; on unknown outcome freeze editing/close-and-resubmit, keep the exact original body/key and use baseline inspection/retry. Known validation/version rejections remain distinguishable from unknown commitment. Preserve MFA step-up, maker-checker proposal and no-self-approval. Private files, passwords, OTPs and keys are never written into a recovery store. Do not alter command journal semantics.
- [ ] **Step 4: Run GREEN.** Run `npm test --workspace apps/web -- src/components/ledger/kit/command-dialog.spec.tsx --reporter=dot`. Expected: exit 0 and all named assertions pass. Run baseline command-recovery, command-request, api-client, harvest-recovery and workspace-command tests; keep equivalent RTL cases for double click, 409, network loss and locale change. Task 10 adds the browser/reload/two-tab cases after product routes exist, so this task does not depend on a future screen.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): preserve command recovery in Ledger dialogs"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 6: Migrate platform admission, identities and governance

**Files:**
- Create: `apps/web/tests/ledger/platform-governance.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/platform-governance.ts`.
- Update: `apps/web/ledger-migration.matrix.json` for task 6 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **23 exact route/screen pairs** where `inventory.routes[].task === 6`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF2: approval/activation follow baseline contracts; auditor cannot write; maker and checker stay distinct.

```ts
test("auditor cannot perform platform decisions", async ({ page, api }) => {
  await api.useActor("auditor"); await api.scenario("governance.pending-enrollment");
  await page.goto("/admin/enterprises");
  await expect(page.getByRole("button", { name: "Phê duyệt" })).toHaveCount(0);
});
test("maker cannot approve own proposal", async ({ page, api }) => {
  await api.useActor("platform-admin"); await api.scenario("governance.own-proposal");
  await page.goto("/admin/approvals/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("button", { name: "Phê duyệt đề xuất" })).toBeDisabled();
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts platform-governance.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Port preview overview/inbox, enterprise review/detail/connections/amendments, users/organizations, assignments, audit, security, approvals and applicable role screens. Add missing new/create/detail views with Ledger fields and decision panels. Platform accounts remain outside enterprise business writes. Separate enrollment approval, capability review, simulated payment and activation exactly as the baseline requires; do not import the later branch's auto-activation behavior. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts platform-governance.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate platform-governance screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 7: Migrate cases, support, privacy and recall coordination

**Files:**
- Create: `apps/web/tests/ledger/platform-cases.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/platform-cases.ts`.
- Update: `apps/web/ledger-migration.matrix.json` for task 7 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **10 exact route/screen pairs** where `inventory.routes[].task === 7`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** Ensure narrow platform roles see only their cases/privacy/support tools and cannot mutate lot quantity; account privacy works without admin elevation.

```ts
test("case manager cannot mutate business inventory", async ({ page, api }) => {
  await api.useActor("case-manager"); await api.scenario("cases.assigned");
  await page.goto("/admin/cases");
  await expect(page.getByRole("button", { name: "Tạo hồ sơ sự cố" })).toBeVisible();
  expect(api.requests().some(r => r.method === "POST" && r.path.startsWith("/lots/"))).toBe(false);
});
test("privacy officer sees scoped privacy records", async ({ page, api }) => {
  await api.useActor("privacy-officer"); await api.scenario("privacy.scoped");
  await page.goto("/admin/privacy");
  await expect(page.getByText("IN_SCOPE_PRIVACY_RECORD", { exact: true })).toBeVisible();
  await expect(page.getByText("OUTSIDE_SCOPE_PRIVATE_RECORD")).toHaveCount(0);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts platform-cases.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Port Ledger case timeline/decision panels, support inbox/detail, consumer-report triage, recall drill, notices, platform privacy and self-service account privacy. Use only baseline case actions and scope-filtered fields. Keep PII private, readonly statuses explicit, and histories append-only; no platform write authority over production/holdings. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts platform-cases.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate platform-cases screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 8: Migrate platform read views, operations and billing

**Files:**
- Create: `apps/web/tests/ledger/platform-operations.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/platform-operations.ts`.
- Update: `apps/web/ledger-migration.matrix.json` for task 8 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **19 exact route/screen pairs** where `inventory.routes[].task === 8`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** Read-only operational pages cannot turn mock capabilities into real mutations; filtered reports retain query semantics.

```ts
test("operator operations are read only", async ({ page, api }) => {
  await api.useActor("platform-operator"); await api.scenario("operations.read-only");
  await page.goto("/admin/operations");
  await expect(page.getByRole("button", { name: /Phát lại outbox|Sửa binding|Chạy sao lưu/ })).toHaveCount(0);
  expect(api.requests().filter(r => r.method !== "GET" && !r.path.startsWith("/auth/"))).toEqual([]);
});
test("trace report retains filters after reload", async ({ page, api }) => {
  await api.useActor("platform-admin"); await api.scenario("operations.trace-report");
  await page.goto("/admin/trace-report?q=TG&status=FAILED"); await page.reload();
  await expect(page).toHaveURL(/q=TG/);
  await expect(page.getByRole("textbox", { name: "Tìm kiếm" })).toHaveValue("TG");
  await expect(page.getByText("TG-FILTERED-TRACE-RECORD", { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts platform-operations.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Port preview operations tabs, ledger/transactions, report views, directory, read-only organization products/lots/chains/QR, reference data, monitoring, backups, security alerts, statistics and billing. Preserve allowed price-publication/settlement actions where baseline permits them. Do not let SYSTEM_ADMIN/AUDITOR create enterprise products or perform business writes. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts platform-operations.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate platform-operations screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 9: Migrate enterprise overview, membership, roles, profile and preferences

**Files:**
- Create: `apps/web/tests/ledger/enterprise-membership.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/enterprise-membership.ts`.
- Create: `apps/web/src/components/ledger/workspace/evidence-panel.tsx`, `evidence-pick.tsx`, `revision-history.tsx`, `image-gallery.tsx`; port the inventoried preview evidence/revision presentation and extract its viewer where needed. This task owns these shared target modules before later domains consume them.
- Update: `apps/web/ledger-migration.matrix.json` for task 9 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **14 exact route/screen pairs** where `inventory.routes[].task === 9`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** Tier 2 delegation cannot exceed its scope; tier 3 cannot manage accounts; locale/theme/preferences survive reload without changing authority.

```ts
test("tier 3 cannot administer accounts", async ({ page, api }) => {
  await api.useActor("org-staff"); await api.scenario("membership.tier3");
  await page.goto("/enterprise/members");
  await expect(page.getByRole("button", { name: /Tạo thành viên|Mời thành viên/ })).toHaveCount(0);
});
test("tier 2 sees only delegated employees", async ({ page, api }) => {
  await api.useActor("org-manager"); await api.scenario("membership.restricted-manager");
  await page.goto("/enterprise/members");
  await expect(page.getByText("DELEGATED_EMPLOYEE", { exact: true })).toBeVisible();
  await expect(page.getByText("OUTSIDE_MANAGER_EMPLOYEE")).toHaveCount(0);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-membership.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Port enterprise shell/overview, inbox, tier tree/list, member detail/edit/invite, group permission editor, owner transfer, profile amendments and settings. Start profile from `src/app/(workspace)/w/profile/page.tsx` and preserve its Ledger form/evidence/revision hierarchy; compose only missing baseline member/profile workflows. Port shared EvidencePanel/EvidencePick/RevisionHistory and gallery presentation here so profile does not depend on Task 10. Preserve source component prop names where compatible (EvidencePanel: entityType/entityId/canManage/required/title/onChanged); bind request/response types, permitted evidence kinds/counts, uploads, supersession, withdrawal and cache scope to the baseline. Do not copy preview API modules or validation constants as authority. Later tasks consume these target modules rather than porting duplicate copies. Keep temporary-password delivery, immutable email rules, role/scope dependencies and owner-transfer deadlines from backend. Keep existing display-customization capabilities via Ledger controls, without old palettes/styles. Preserve website/contact/legal content as business data only. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-membership.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check. Cover profile evidence access denial/revocation without optimistic success and private evidence/cache cleanup with their own RED/GREEN cycles. Add browser identity-switch/cache tests from Task 4 after the enterprise overview exists: actor A's visible private record must disappear before actor B's request resolves.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate enterprise-membership screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 10: Build complete product management and evidence UI

**Files:**
- Create: `apps/web/tests/ledger/enterprise-products.spec.ts`, `apps/web/tests/ledger/commands.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/enterprise-products.ts`.
- Consume: Task 9's `apps/web/src/components/ledger/workspace/{evidence-panel,evidence-pick,revision-history,image-gallery}.tsx`; do not create duplicate shared target modules.
- Update: `apps/web/ledger-migration.matrix.json` for task 10 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **5 exact route/screen pairs** where `inventory.routes[].task === 10`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Test-only in `fixtures/enterprise-products.ts`: `selectProductCsv(page: Page, variant: "valid" | "changed"): Promise<void>` and `fillValidProductForm(page: Page): Promise<void>`; use complete baseline DTO fixtures.
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF5: private product evidence, minimum completion rules and import preview digest are enforced by baseline; rows belong to current organization.

```ts
test("insufficient product evidence blocks completion", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("products.two-photos");
  await page.goto("/enterprise/products/22222222-2222-4222-8222-222222222222");
  await expect(page.getByRole("button", { name: "Hoàn tất sản phẩm" })).toBeDisabled();
});
test("changing CSV invalidates a successful preview", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("products.import-digest-changed");
  await page.goto("/enterprise/products/import");
  await selectProductCsv(page, "valid");
  await page.getByRole("button", { name: "Xem trước" }).click();
  await expect(page.getByRole("button", { name: "Áp dụng nhập" })).toBeEnabled();
  await selectProductCsv(page, "changed");
  await expect(page.getByRole("button", { name: "Áp dụng nhập" })).toBeDisabled();
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-products.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Start from the now-available `src/app/(workspace)/w/products/page.tsx`, using its Ledger list, action menus, drawers, evidence and revision presentation. Adapt this presentation to baseline list/search/filter/pagination, canonical new/detail/edit URLs, active/inactive state and CSV preview/apply. Use Task 9's shared evidence/revision/gallery modules. Use baseline catalog-csv parser/DTO rules, current version and server digest; do not invent Excel endpoints or port preview API/types/schema behavior. Reject spoof MIME/oversize files per backend; keep raw evidence private and history intact. Do not claim a product active before backend completion; validate at least the baseline's three product images. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-products.spec.ts commands.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check. In commands.spec.ts: fillValidProductForm, submit once, simulate lost response, assert pending, reload/reconcile, wait for confirmed outcome and compare captured POST body/key unchanged; include two-tab and locale-change variants. Cover required SKU/origin/category, stale version, duplicate SKU, CSV quotes/newlines/formula-safe export where supported, reordered/withdrawn images, organization switching and image/PDF privacy with their own RED/GREEN cycles.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate enterprise-products screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 11: Build farms/plots, materials, sites and vehicles with evidence/revisions

**Files:**
- Create: `apps/web/tests/ledger/enterprise-resources.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/enterprise-resources.ts`.
- Update: `apps/web/ledger-migration.matrix.json` for task 11 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **13 exact route/screen pairs** where `inventory.routes[].task === 11`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Test-only in `fixtures/enterprise-resources.ts`: `fillValidSiteRevision(page: Page): Promise<{name: string}>`; baseline-valid fixture changes the name to "Kho kiểm thử".
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF5: missing required evidence and restricted facility scope cannot be bypassed; stale revisions are rejected without an optimistic local success.

```ts
test("resource completion requires evidence", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("resources.missing-evidence");
  await page.goto("/enterprise/areas/33333333-3333-4333-8333-333333333333");
  await expect(page.getByRole("button", { name: "Hoàn tất hồ sơ" })).toBeDisabled();
});
test("stale site revision preserves input", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("resources.stale-site");
  await page.goto("/enterprise/sites/44444444-4444-4444-8444-444444444444");
  const values = await fillValidSiteRevision(page);
  await page.getByRole("button", { name: "Lưu chỉnh sửa" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Tên cơ sở")).toHaveValue(values.name);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-resources.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Port the available `w/areas`, `w/materials` and updated `w/sites` preview pages selected by taskReferences, preserving their distinct Ledger lists, forms, drawers, revision and completion presentation. Compose only missing baseline farm/plot/material/site/vehicle create/detail workflows and keep their canonical URLs. Reuse Task 9's shared evidence/revision components. Fields, evidence groups/counts, deactivation with stock, assignment scope and quantity references come from real backend. TDD each resource family separately and commit each passing family. Do not infer stock from capacityKg or copy mock simplifications. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-resources.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate enterprise-resources screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 12: Migrate partnerships, messaging, service onboarding and commerce

**Files:**
- Create: `apps/web/tests/ledger/enterprise-coordination.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/enterprise-coordination.ts`.
- Create: `apps/web/src/components/ledger/workspace/partner-profile.tsx`; this task owns the port from the inventoried preview component.
- Update: `apps/web/ledger-migration.matrix.json` for task 12 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **15 exact route/screen pairs** where `inventory.routes[].task === 12`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF2: paid simulated contract does not by itself grant active business access; partnership does not grant chain membership.

```ts
test("paid simulated order does not bypass activation", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("service.paid-not-activated");
  await page.goto("/enterprise/service");
  await expect(page.getByText("Chờ kích hoạt", { exact: true })).toBeVisible();
  expect(api.requests().filter(r => r.method === "POST" && !r.path.startsWith("/auth/"))).toEqual([]);
});
test("partner acceptance does not reveal private chain data", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("partners.accepted-without-chain");
  await page.goto("/enterprise/partners");
  await expect(page.getByText("ACCEPTED_PARTNER", { exact: true })).toBeVisible();
  await expect(page.getByText("UNASSIGNED_CHAIN_PRIVATE_RECORD")).toHaveCount(0);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-coordination.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Start partner UI from the updated `w/partners` page and `src/components/workspace/partner-profile.tsx`; port its Ledger profile dialog, then bind baseline partner search/invite/resolution and external-partner evidence through Task 9's shared components. Port internal messages, notices, help/support, enterprise billing/renewals, signup review status, service quote/contract/payment and connection requests from available taskReferences or compose only gaps. Keep exact baseline enrollment/service stages and payment simulation labels. Follow real plan catalog/quotas and signed/acknowledged quotation semantics; no fake checkout, auto business grants or real payment integration. Peer forms accept public connection metadata only, never signing keys/SSH credentials. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts enterprise-coordination.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate enterprise-coordination screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 13: Build chain management, plans, permission views and signer UI

**Files:**
- Create: `apps/web/tests/ledger/supply-chain-signing.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/supply-chain-signing.ts`.
- Update: `apps/web/ledger-migration.matrix.json` for task 13 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **10 exact route/screen pairs** where `inventory.routes[].task === 13`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF4/RF5: modified signed content cannot be submitted; signer failure cannot downgrade the command; current assignment and epochs remain authoritative.

```ts
test("tampered signed payload is blocked", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("signing.digest-mismatch");
  await page.goto("/supply-chains/55555555-5555-4555-8555-555555555555/signing");
  await expect(page.getByRole("button", { name: "Ký và gửi" })).toBeDisabled();
});
test("unsupported signer does not offer unsigned fallback", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("signing.unavailable");
  await page.goto("/enterprise/signing");
  await expect(page.getByRole("button", { name: /Gửi không ký/ })).toHaveCount(0);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts supply-chain-signing.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Start from the available `src/app/(workspace)/w/chains/page.tsx` and preview grants editor. Preserve its Ledger hierarchy for chain list/create/detail, stages, invitations and permissions, then compose missing baseline consent/plans, business/ledger/signing and organization-key screens. Retain baseline canonicalization/key-store/Ed25519 helpers and authority checks; preview chain/signing/API implementation is not authoritative. Do not change blockchain payload, binding, envelope, epoch or signer fallback. Make frontend access depend on server capabilities/accepted assignments; no role-only bypass. Preserve baseline key storage/export policy; private keys must not enter API requests, logs or migration artifacts. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts supply-chain-signing.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check. Run existing distribution-signer/signing/canonicalization tests plus stale membership/capability/consent, revoked signer, reload during signing and duplicate-submit scenarios.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate supply-chain-signing screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 14: Build production cycles, journals, harvests, compliance and IoT UI

**Files:**
- Create: `apps/web/tests/ledger/production-harvest.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/production-harvest.ts`.
- Create: `apps/web/src/lib/ledger/ops-labels.ts`, `use-now.ts`; port inventoried display-only labels/clock, map labels to baseline enums and keep business timing rules authoritative on the baseline.
- Update: `apps/web/ledger-migration.matrix.json` for task 14 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **11 exact route/screen pairs** where `inventory.routes[].task === 14`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Test-only in `fixtures/production-harvest.ts`: `fillValidHarvest(page: Page): Promise<{quantityText: string}>`; fills every required field/evidence using baseline DTO fixtures.
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** Actions require current assignment/version and evidence; harvest remains recoverable and creates source-preserving lots only through API.

```ts
test("unassigned staff cannot create harvest", async ({ page, api }) => {
  await api.useActor("org-staff"); await api.scenario("production.no-assignment");
  await page.goto("/production-cycles/66666666-6666-4666-8666-666666666666/harvest/new");
  await expect(page.getByRole("button", { name: "Ghi nhận thu hoạch" })).toHaveCount(0);
});
test("stale harvest keeps entered quantity", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("production.harvest-conflict");
  await page.goto("/production-cycles/66666666-6666-4666-8666-666666666666/harvest/new");
  const values = await fillValidHarvest(page);
  await page.getByRole("button", { name: "Ghi nhận thu hoạch" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Khối lượng thu hoạch")).toHaveValue(values.quantityText);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts production-harvest.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Start from the available `src/app/(workspace)/w/cycles/page.tsx` for Ledger cycle/draft creation, planting, care journal and harvest presentation, with Task 9's evidence selection/revision components and the inventoried display helpers. Bind all baseline detail/journal/harvest URLs; compose only missing assigned compliance/IoT or workflow views. Use only baseline supported production types and genuine evidence selection rules, sensor windows, optimistic versions, authorization and harvest recovery. Preview ops APIs, enums and validation cannot replace baseline behavior. Distinct workflow pages follow the Ledger kit rather than transplanting old production panels or rendering every endpoint as one generic form. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts production-harvest.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate production-harvest screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 15: Build lots, inventory, distribution, custody reports and enterprise QR

**Files:**
- Create: `apps/web/tests/ledger/inventory-distribution.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/inventory-distribution.ts`.
- Create: `apps/web/src/components/ledger/workspace/lineage-panel.tsx`; this task owns the port before Task 16 consumes it.
- Update: `apps/web/ledger-migration.matrix.json` for task 15 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **10 exact route/screen pairs** where `inventory.routes[].task === 15`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Test-only in `fixtures/inventory-distribution.ts`: `fillValidDistribution(page: Page): Promise<void>`; fills all participants, lines, amounts and evidence from baseline-valid fixtures.
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF4: a retry cannot duplicate quantity movement; keep legacy Shipment and multi-line distribution eligibility distinct.

```ts
test("lost transfer response is reconciled without a second POST", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("distribution.committed-response-lost");
  await page.goto("/distribution/new");
  await fillValidDistribution(page);
  await page.getByRole("button", { name: "Tạo phiếu phân phối" }).click();
  await expect(page.getByTestId("ledger-command-pending")).toBeVisible();
  const sent = api.requests().filter(r => r.method === "POST" && !r.path.startsWith("/auth/"));
  expect(sent).toHaveLength(1);
  await page.getByRole("button", { name: "Đối soát" }).click();
  await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);
  expect(api.requests().filter(r => r.method === "POST" && !r.path.startsWith("/auth/"))).toEqual(sent);
});
test("unsupported signed distribution path stays blocked", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("distribution.dual-signed-disabled");
  await page.goto("/distribution/new");
  await expect(page.getByRole("button", { name: "Tạo phiếu phân phối" })).toBeDisabled();
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts inventory-distribution.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Port the available `w/lots`, `w/inventory`, `w/distribution` and `w/qr` screens selected by taskReferences. Preserve their Ledger tables, stock/detail panels, transfer form/steps and print presentation; adapt to all baseline canonical routes/actions and compose only gaps. Port `src/components/workspace/lineage-panel.tsx` here for lot views and Task 16, replacing preview proc API/types with baseline lineage consumers; keep other organizations' private balances/status hidden according to baseline response/scope. Use Task 9's evidence components. Preserve source lot, available quantity, custody and all command recovery/signature rules. Surface allowedCommands/status rather than inventing actions. Keep restrictions on new distribution for signed bindings exactly as baseline. Public proof/verified labels never imply quality certification. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts inventory-distribution.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate inventory-distribution screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 16: Build processor workflows and mass-balance UI

**Files:**
- Create: `apps/web/tests/ledger/processing.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/processing.ts`.
- Update: `apps/web/ledger-migration.matrix.json` for task 16 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **4 exact route/screen pairs** where `inventory.routes[].task === 16`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Test-only in `fixtures/processing.ts`: `fillProcessingForm(page: Page, input: {inputKg: string; outputKg: string}): Promise<void>`; all units are kg with 1:1 conversion and other fields valid.
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** Only eligible organizations can process; invalid mass balance and stale version cannot be shown as successful.

```ts
test("invalid mass balance cannot submit", async ({ page, api }) => {
  await api.useActor("processor"); await api.scenario("processing.mass-balance-invalid");
  await page.goto("/enterprise/processing/new");
  await fillProcessingForm(page, { inputKg: "100", outputKg: "120" });
  await expect(page.getByRole("button", { name: "Tạo lệnh chế biến" })).toBeDisabled();
  expect(api.requests().filter(r => r.method === "POST" && !r.path.startsWith("/auth/"))).toEqual([]);
});
test("non-processor cannot write processing", async ({ page, api }) => {
  await api.useActor("retailer"); await api.scenario("processing.no-capability");
  await page.goto("/enterprise/processing");
  await expect(page.getByRole("button", { name: "Tạo lệnh chế biến" })).toHaveCount(0);
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts processing.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Start from the available `src/app/(workspace)/w/processing/page.tsx`, preserving its Ledger run list, form, conversion-factor controls and complete/cancel presentation. Use Task 15's target lineage panel without re-porting it. Bind baseline canonical list/create/detail workflows and processing DTO/services; preview proc APIs/types and mock calculations cannot substitute for these contracts. Preserve raw-lot ownership, availability, unit conversions, mass balance, authority and output-lot lineage. New visible controls and live validation use Ledger components; backend calculations stay authoritative. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts processing.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate processing screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.


### Task 17: Replace public landing, legal pages, scanner and trace UI

**Files:**
- Create: `apps/web/tests/ledger/public-trace.spec.ts`.
- Create: `apps/web/tests/ledger/fixtures/public-trace.ts`.
- Modify/Create: `apps/web/src/app/error.tsx`, `not-found.tsx`, `loading.tsx`; Ledger-only global states.
- Update: `apps/web/ledger-migration.matrix.json` for task 17 only.
- Update only the old renderer-specific tests touched by this domain; preserve and record their business assertions.
- Modify/Create: the **5 exact route/screen pairs** where `inventory.routes[].task === 17`; use literal `sourceFile` and `targetScreen` fields. No other task owns these files.

**Interfaces:**
- Consumes: `LedgerScreenProps` (Task 2), Ledger kit/shell (Task 3), `ledgerRequest<T>` and `LedgerApiFixture` (Task 4), command/recovery contract (Task 5).
- Produces: default `LedgerScreen(props: LedgerScreenProps): React.JSX.Element` at each owned `targetScreen`, its canonical wrapper, typed scenarios and verified action/matrix entries.

- [ ] **Step 1: Write the failing test(s).** RF5: QR input cannot navigate off-origin or expose private records; warnings remain visible when proof is VERIFIED.

```ts
test("foreign QR cannot navigate off-origin", async ({ page, api }) => {
  await api.useActor("anonymous"); await api.scenario("trace.public");
  await page.goto("/scan");
  await page.getByLabel("Mã hoặc đường dẫn truy xuất").fill("https://evil.example/trace/abc");
  await page.getByRole("button", { name: "Tra cứu" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL!).origin);
});
test("verified recalled lot keeps warning", async ({ page, api }) => {
  await api.useActor("anonymous"); await api.scenario("trace.verified-recalled");
  await page.goto("/trace/fixture-public-token");
  await expect(page.getByTestId("ledger-trace-warning-recall")).toBeVisible();
});
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts public-trace.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Build fresh public screens and LedgerPublicShell from Ledger kit/tokens only; preview lacks a public landing/trace design so create their hierarchy without referencing the old landing/header/footer/trace layout. Keep required legal/business content and site-contact data separately from old markup. Reuse only baseline QR parsing/generation/camera decoding logic. Camera requires user action, stops on exit/hidden page, and denial/invalid image/manual entry work. Respect existing valid token formats and same-origin policy; reject foreign/malformed inputs according to baseline parsing, never by guessed token length. Create Ledger-only error/not-found/loading UI too. Apply the shared domain execution contract to all owned route/screen pairs.
- [ ] **Step 4: Run GREEN.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts public-trace.spec.ts --project=contract --reporter=dot`. Expected: exit 0 and all named assertions pass. Also run this domain's retained headless tests and UI-origin check. Modify apps/web/src/app/error.tsx, not-found.tsx and loading.tsx with new Ledger states; keep public/private API caching rules. Add expiry/integrity/missing-sensor combinations, long hashes/names, camera-denied and no-autostart tests; describe hardware camera/PWA limits honestly.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): migrate public-trace screens to Ledger"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.

### Task 18: Remove all legacy presentation and prove whole-branch acceptance

**Files:**
- Delete: legacy component/style/render paths from the approved inventory, except canonical app route/layout files already replaced by new wrappers/renderers and AST-proven `retainedHeadless` infrastructure from Task 1. No visual exemption.
- Update: `apps/web/ledger-migration.matrix.json`, `docs/frontend.md`, plan task checkboxes and technical decisions.
- Create: `apps/web/tests/ledger/route-coverage.spec.ts`, `responsive-accessibility.spec.ts`, `visual-ledger.spec.ts`.
- Create: `apps/web/tests/ledger/matrix.ts`; validated test-only loader, never import it into runtime.
- Modify UI selectors only in `scripts/ci/hybrid-browser-scenarios.mjs`, `enterprise-browser-scenarios.mjs` as needed; preserve fixture/business/crypto assertions and isolation.

**Interfaces:**
- Consumes: all prior completed tasks and their exact commits, source provenance inventory, full action matrix, frozen preview reference images, baseline/head SHAs.
- Produces: `readLedgerMatrix(): LedgerMigrationMatrix` from `tests/ledger/matrix.ts`; validate JSON with Zod and fixture actor keys before returning typed rows (`actorKey: ActorKey`, `scenarioId: string`, `exampleUrl: string`, `readyHeading: string`, actions/tests/status). Invalid/unknown actors, empty readiness fields or duplicate routes fail, without unchecked type casts. Tests below import this loader and the approved inventory metadata.
- Produces: no legacy presentation/import/fallback, every baseline route/action verified, green source/build checks and isolated runtime evidence, clean independent review and local branch/worktree handoff.

- [ ] **Step 1: Write the failing test(s).** RF1–RF5: final audit has no missing routes/actions, no legacy UI dependency, no mutation of protected source, and no mock runtime; all viewport/locale/theme and access states stay usable.

```ts
const matrix = readLedgerMatrix();
test("all baseline route actions have a verified owner", async () => {
  expect(matrix.routes).toHaveLength(inventory.routes.length);
  expect(matrix.routes.every(r => r.status === "verified"
    && r.actions.length > 0 && r.actions.every(a => a.tests.length > 0 && a.status === "verified"))).toBe(true);
});
for (const row of matrix.routes) {
  test(`Ledger deep link ${row.route}`, async ({ page, api }) => {
    await api.useActor(row.actorKey);
    await api.scenario(row.scenarioId);
    await page.goto(row.exampleUrl);
    await expect(page.getByRole("heading", { name: row.readyHeading, exact: true }))
      .toBeVisible();
  });
}
// responsive-accessibility.spec.ts tests widths [320, 390, 768, 1440],
// vi/en, light/dark, focus/Escape, reduced motion and long values.
// expected: no document-level horizontal overflow, hidden private data,
// missing actionable control, or old fallback renderer.
```

- [ ] **Step 2: Run RED.** Run `npx playwright test --config apps/web/playwright.ledger.config.ts route-coverage.spec.ts --project=contract --reporter=dot`. Expected: the named missing behavior fails (RED); follow the shared TDD contract.
- [ ] **Step 3: Implement.** Delete every remaining old visual source/style/helper and remove all imports; keep only baseline headless logic. Run check-ui-origin final mode and check-change-scope against the actual baseline SHA. Update guide/route/action mapping, screenshot references and Next 16 local/Docker instructions. Migrate existing browser selectors to Ledger without weakening assertions or reading old visuals as reference. Do not mark a missing/new placeholder screen verified. In contract browser capture and compare to frozen Ledger source screenshots; do not create snapshots blindly to make a failing comparison pass. Keep API/Fabric/hardware evidence separate.
- [ ] **Step 4: Run GREEN.** Run `npm run check --workspace apps/web`. Expected: exit 0 and all named assertions pass. Run the complete final acceptance command list below. Record failed or unavailable gates explicitly; no skip/mock substitutes. No final success claim until required gates and Critical/Important review findings are resolved.
- [ ] **Step 5: Commit.** Follow the shared commit contract; `git commit -m "refactor(web): remove legacy UI and finalize Ledger migration"`. Record SHA/results in the ignored task ledger; complete only after its gate passes.

## Final acceptance commands and evidence

Run commands sequentially in the new worktree with supported Node/npm. Capture output to local logs; report exit code, failing excerpt or final summary. Commands below are planned checks, not claims they have already run.

1. `node --test scripts/ledger/audit-baseline.test.mjs scripts/ledger/check-ui-origin.test.mjs scripts/ledger/check-change-scope.test.mjs apps/web/scripts/runtime-contract.test.mjs`.
2. `node scripts/ledger/check-ui-origin.mjs --inventory docs/superpowers/specs/2026-10-22-ledger-ui-migration.inventory.json --phase final` → exit 0 and zero violations.
3. `node scripts/ledger/check-change-scope.mjs --base <actual-baseline-SHA>` → exit 0, no API/DB/Fabric/Worker/deploy/generated-contract mutation. Substitute the SHA recorded by Task 1; do not use origin/main or the planning checkout HEAD.
4. `npm run check --workspace apps/web` → typecheck, Vitest, lint contract, image optimizer tests, lint and production build all pass; do not repeat the whole suite without a new reason.
5. `npx playwright test --config apps/web/playwright.ledger.config.ts --project=contract --reporter=dot` → all route/workflow/role/responsive/visual scenarios pass; no unhandled API requests or browser console errors.
6. Run existing isolated browser harness `npm run test:hybrid:browser` after verifying prerequisites and actual target in the repo runbook. Record which backend/DB/Fabric paths really ran and any unavailable stage; never infer real Fabric evidence from a skipped/mock stage. Do not point it at the demo stack or production. Retain business/crypto assertions; only UI selectors/interactions may change for Ledger.
7. Build the web Dockerfile from the worktree context with real-API/non-mock args and verify standalone server startup, /login, public trace route, image/asset loading and same-origin API proxy behavior. Do not deploy or replace running containers.
8. Check every row/action in the actual baseline matrix, not only 143 HTML responses. Add a row for any newly discovered baseline action or endpoint consumer. Every route has a Ledger screen; no old-renderer fallback, placeholder or fake success.
9. Inspect `git diff --check`, actual changed paths, lockfile scope, and `git status`. Secrets, snapshots/logs/trace, personal runtime config and scratch must be absent from staged files.

If isolated runtime/hardware prerequisites are unavailable, identify the exact unmet gate and preserve the branch. Unit/contract/build success does not establish real Fabric, camera hardware, PWA HTTPS or production acceptance. Do not mark the plan fully accepted merely because mocks pass.

### Final independent review — Native

- Use `superpowers:requesting-code-review` once for the completed branch, with `agritrace-reviewer`; if unavailable use a fresh standard reviewer with repo reviewer instructions and disclose the fallback.
- Supply the exact baseline/head SHAs, spec/plan Global Constraints, changed-file list, new UI implementation, provenance/coverage results and actual evidence. Send only relevant task/branch context, not this entire chat.
- Reviewer must check old-UI reuse/hidden fallback, API/auth/recovery/organization scope, custody/signatures/privacy and unsupported/mock actions. Existing source UI for comparison is the approved **Ledger preview**, not the old frontend.
- Apply `receiving-code-review`; verify findings, reject unsupported suggestions with evidence, and fix Critical/Important issues through RED→GREEN plus the affected suite. Re-run broad checks only when the fix affects their covered behavior. Do not loop fresh whole-branch reviews without a new unresolved concern.
- Apply `verification-before-completion` to the final state and then `finishing-a-development-branch`. The selected result is local commits on `refactor/ledger-ui-migration`, worktree retained for human review. Do not archive/delete it, push, open a PR, merge or deploy without a separate request.

## Self-review record for this written plan

- [x] Every agreed requirement in the design spec maps to a task; task IDs cover all 143 stored route paths exactly once.
- [x] Old layout/component/CSS prohibition is explicit, including renamed files, transitive imports, renderer-in-lib and CSS-only reskinning.
- [x] The approved UI source, wrong look-alike paths, backend source, current excluded commit and exact proposed branch/worktree are spelled out.
- [x] Route input, request/query contracts, screen exports, fixture API and task dependencies use consistent names; no new public API/schema is proposed.
- [x] RF1–RF5 each has a named owning test/task and a final acceptance check.
- [x] Missing preview features are implementation work on the target branch; no preview repair or mock swap can stand in for preserved functionality.
- [x] Native execution and end-of-branch independent review reflect the user's explicit choice; no subagents were needed to self-review this plan.
- [x] Preview refresh maps all 19 added presentation/display inputs and 8 changed hashes; shared evidence/revision modules are produced in Task 9, partner profile in Task 12 and lineage in Task 15, before their consumers. Task 1 rediscovers additions as well as changed hashes.
- [x] Plan-writing changes are limited to these technical documents. No product implementation, source pull/checkout switch, new branch/worktree, dependency install or application test was performed by writing this plan.

## New-chat execution handoff

Copy the following message into a new **local** chat when you want execution. It supplies the plan location and already-selected method; the new chat must read the plan/spec and parse only inventory metadata/current-task rows, not rely on the old conversation.

```text
Tôi yêu cầu triển khai kế hoạch đã chốt, không lập lại một kế hoạch mới.

Đọc plan/spec và nạp metadata/các dòng thuộc task đang làm trong inventory (không in toàn bộ JSON):
C:/Users/kieup/Desktop/agri-trace-blockchain/docs/superpowers/plans/2026-10-22-ledger-ui-migration.md
C:/Users/kieup/Desktop/agri-trace-blockchain/docs/superpowers/specs/2026-10-22-ledger-ui-migration-design.md
C:/Users/kieup/Desktop/agri-trace-blockchain/docs/superpowers/specs/2026-10-22-ledger-ui-migration.inventory.json

Nguồn nghiệp vụ: bản mới nhất của origin/feature/admin-console-processor sau fetch.
Nguồn UI/UX duy nhất, chỉ đọc:
C:/Users/kieup/Desktop/Fe-clone-Agritrace/agritrace-admin-preview

Tạo nhánh refactor/ledger-ui-migration trong worktree riêng theo plan. Không dùng checkout feature/enterprise-registration-plans hoặc commit 61fcbb3 làm nền.
Thay toàn bộ web bằng Ledger, nâng Next.js 16.4.2 + React 19.3.0, giữ đầy đủ chức năng/API/quyền/URL của baseline.
Inventory đã bổ sung các màn doanh nghiệp và component preview mới; dùng uiSource.taskReferences của task hiện tại. Task 1 phải quét cả file mới/đổi/mất theo uiSource.discovery trước khi đóng snapshot, không chỉ kiểm lại hash danh sách cũ. Màn preview đã có thì lấy UI đó; chỉ xây bổ sung phần baseline còn thiếu và giữ đúng thứ tự tạo component dùng chung trong plan.
TUYỆT ĐỐI KHÔNG tái sử dụng bố cục, DOM trình bày, component UI, sidebar/menu/breadcrumb, CSS, token hoặc ảnh tham chiếu của giao diện cũ; không đổi tên rồi dùng lại, không chỉ thay màu/CSS, không giữ UI cũ làm fallback. Chỉ giữ logic không có giao diện. Màn hình thiếu phải xây mới theo Ledger trên nhánh đích.

Tôi đã chọn Native: dùng superpowers:using-superpowers, using-git-worktrees và executing-plans; TDD theo task, systematic-debugging khi lỗi, verification-before-completion trước kết luận; một reviewer agritrace-reviewer độc lập toàn nhánh ở cuối. Không chia implementer/reviewer cho từng task.
Đọc ledger + Git để tiếp nối task đã hoàn thành, không làm lại và không hỏi lại các lựa chọn đã chốt. Nếu đã có worktree/nhánh đúng task thì tiếp tục tại đó, không tạo lại hay reset. Copy ba tài liệu vào worktree mới vì chúng có thể đang uncommitted ở checkout điều phối. Bắt đầu task chưa hoàn thành (Task 1 nếu chưa triển khai), xác nhận SHA baseline và nguồn snapshot, rồi thực thi tuần tự đến hết các gate. Không sửa preview/backend/DB/Worker/chaincode; không tự push, PR, merge hoặc deploy.
```
