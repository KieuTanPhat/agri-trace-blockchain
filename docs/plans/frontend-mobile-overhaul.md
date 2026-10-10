# Frontend integration and mobile plan

Date: 2026-10-10. Related: AGT-028 (#40); this UI change does not constitute the issue's full business acceptance.

## Scope and sequence

1. Integrate the approved Vietnamese information landing page at `/`. Retain the existing Be Vietnam Pro font, green palette, panel and button style. Do not show sample QR, demo lots or login links on this page.
2. Move the authenticated overview to `/dashboard`. Access login directly at `/login`, default successful login to `/dashboard`, retain validated internal return paths and existing role rules.
3. Refine the shared shell, public header, typography, spacing and forms. Provide mobile navigation, card views for data lists, single-column forms and dialogs which fit the viewport. Cover dashboard, lots/detail, cycles, administration/assignments, compliance, scanner, public trace, simulator, gallery and error pages.
4. Reuse the generated Swagger DTOs and current command permissions. Retain warning priority, read-only auditor behavior and network-only business data in the service worker. Camera/upload/manual QR resolution must use the same validated local trace route.
5. Verify frontend typecheck, tests, lint contract, image optimizer and production build. Inspect public and authenticated views at 320, 390, 768 and 1440 pixels, including long identifiers and empty/error states. Browser fixtures are local QA evidence, not production acceptance.
6. Create a PR from an isolated branch based on current main. Require Application, Blockchain and Dependency gates on the current head, review the diff and merge without bypassing repository protection.

## Boundaries

No API/schema or business policy changes. Preserve ongoing edits in the original checkout. Login remains directly reachable; removing its landing link is a navigation choice, not an access-control mechanism. Camera requires HTTPS outside localhost and device permission. Live hardware scanning and production business acceptance remain distinct from automated and fixture checks.
