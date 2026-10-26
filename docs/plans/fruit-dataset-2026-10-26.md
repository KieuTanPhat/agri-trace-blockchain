# Fruit dataset implementation plan

> Execution: superpowers:executing-plans, in the existing feature/mobile-apps-backend worktree. Preserve all pre-existing staged and unstaged mobile/backend changes.

## Accepted scope

28 products: 25 fresh fruit and three processed products from the operator's Desktop/Data directory. One current product photo is sufficient; other activity photos may be reused as illustrations. Natural Vietnamese names and copy, balanced organization roles and enterprise tiers. Keep provenance in a private asset manifest; never represent an unrelated original document as an authentic credential of a fictional organization. Use redacted reference copies without modifying originals.

The operator explicitly authorizes deleting all application data, including users, without backup in agri_trace, container agri-trace-demo-local-postgres-1, host port 5433. Preserve Desktop/Data, other databases, volumes and working changes. Recreate from committed plus current branch migrations. Do not automatically delete previous backups. Public hosting with real Fabric is a separate environment: local simulation is not a Fabric receipt. Recreate commands against the target binding rather than export simulated ledger history.

## Architecture and alternatives

Extend the existing checkpointed API seed rather than inserting trace/history directly. Bootstrap identities and entitlements only; business writes use API transaction/journal/outbox. Existing simulator can support local Web/mobile acceptance, but a separate real Fabric network and a supplied domain are required for public acceptance. Do not silently downgrade the requested public Fabric target or claim it is deployed.

## Tasks

- [x] Prepare the 28-product catalog, local asset manifest, redacted document copies and matching organization logos. Verify files before reset.
- [x] Test and implement one-photo activation/removal consistently in API, Web and maintained documentation.
- [x] Extend checkpointed seed for all products, meaningful production/harvest/distribution/processing states, balanced users/roles, private/public media, and mobile public directory/content.
- [x] Add explicit no-backup fresh-local operator path with exact container/project/database/port checks; migrate and seed only after preflight.
- [x] Build the current API and Web, reset the authorized DB, run seed, verify accounts, cross-organization scope, quantity, QR and public privacy.
- [x] Start Web and mobile preview against the same API; verify the principal flows, preserve credentials in ignored local artifacts, and report access URLs and real Fabric/public-hosting prerequisites.

## Production scope selected after local acceptance

**Owner authorization renewed 26–27/10/2026:** open the PR, require CI/CD success, then reinstall the existing production using this 28-product dataset without backing up the old application data. Delete only AgriTrace accounts, media, database and Fabric instance. Preserve OS, SSH, Edge domain/TLS state, observability and unrelated services. Production inspection remains read-only until the reviewed candidate and real-ledger seed are ready.

The owner subsequently selected the existing production installation and expressly requested deleting its current application data. This supersedes the separate-domain proposal. Prepare the complete release and real-ledger seed before the destructive step; never run the local simulator/reset wrapper on production. Retain Edge HTTPS state, delivery access and unrelated VPS services. Production inventory and release evidence belong to private artifacts.

- [ ] Integrate the mobile/backend feature and dataset on an immutable candidate; pass exact-candidate CI and publish pinned images.
- [ ] Wire native authentication configuration without enabling draft production registration or claiming Firebase/SMS acceptance.
- [ ] Prepare and rehearse hosted API seeding with real binding registration, registry permissions, Worker delivery and direct proof verification. Do not copy local simulated history.
- [ ] Prepare a reviewed resource manifest and installation generation for production reinstall; preserve host/delivery locks and journal.
- [ ] Replace only inventoried AgriTrace database/Fabric resources after the candidate and seed are ready; verify HTTPS, Web, native sessions, domain quantities and actual Fabric proof before opening access.

## Verification and review focus

Tests must cover accepting one photo and rejecting zero photos, preventing withdrawal of the last active product photo, wrong-target reset refusal, restart/checkpoint safety and exact product coverage. Runtime verification includes SQL quantity reconciliation, role logins and negative authorization, all public traces, directory images and browser/mobile requests. Keep run evidence in ignored artifacts, not additional Markdown reports. Do not call simulator output Fabric verification.

## Consumer directory correction from supplied visual references

Replace mobile monograms with published product images and organization logos. Match the supplied two-column product cards, compact enterprise rows, green/blue header, sorting/filter controls and image-led detail structure. Adapt the content to AgriTrace: indicative VND price per unit, actual scan count, related products, enterprise contacts, expandable product information and links to real lots. Do not add fabricated quality certification, barcode, reviews or map coordinates.

Public presentation is an explicit separate snapshot in the new additive `public_directory_publication` table. Submitted registration/acceptance evidence remains immutable. Only selected logos, current public lot photos and explicitly published journey media are served; every request rechecks visibility. Publication withdrawal and private image supersession must close access. Production publication follows the renewed release authorization and gates above.

### Release execution order

Release remains blocked by unpatched `node-forge <=1.4.0` in Expo CLI
(`GHSA-86w9-cpqp-85rv`). Mobile dependency audit is required; do not hide the
advisory, lower the gate or describe an exported build as production accepted.
The production reset is not performed while this gate is unresolved.

- [ ] Commit the current source and independent mobile lockfile, scan the staged files for credentials/local artifacts, push `feature/mobile-apps-backend` and open a PR into current `main`.
- [ ] Resolve independent review findings and CI failures; require Application, Blockchain (including real Fabric) and Dependency gates for the final candidate.
- [ ] Prepare ACheck web export at `/consumer` alongside the existing Web app; keep its API same-origin and management on `nongtrace.site`. Preserve native app identity and do not claim store submission/SMS acceptance.
- [ ] Add a production-target adapter for the checkpointed seed. It must accept only the verified installation generation, bootstrap dataset identities separately from the five technical smoke accounts, provision new chain bindings through one-off operator identities and atomically update the Worker inventory. Never weaken the local-target guard or import local events/proofs/journal.
- [ ] Rehearse the 28-product seed with real ledger delivery and verify signatures, permissions, stock, images and public privacy before downtime. Unknown commands keep their original key/body for reconciliation.
- [ ] With exact main push CI and immutable publication ready, hold delivery, inventory literal production-owned resources, stop writers, remove only that inventory without backup and create a fresh DB/network/generation using the production reinstall protocol.
- [ ] Run `reinstall`, resume the same candidate/generation on interruption, seed via API, verify direct ledger receipts, all 28 product images, enterprise logos, news and browser/mobile access; report actual results and stop.

- [x] API projection, binary image routes, explicit local publication and generated contract.
- [x] Mobile product/enterprise lists and details, actual QR, sorting, search and filters.
- [x] Real PostgreSQL privacy/revocation tests and browser checks at 320/413/770 pixels.
