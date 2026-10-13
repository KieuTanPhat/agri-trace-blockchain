# Current business rules and acceptance boundaries

Updated 2026-10-13. Use current source, SQL guards and generated Swagger for the
implemented API, and current AGT issues for acceptance. The hosted Hybrid release
is still undergoing validation; the rules below are requirements to preserve.

- A current authenticated account and session, organization, capability,
  membership, grant and accepted assignment authorize business actions. Check
  under locks and before replay. Read/list/count/proof/allowedCommands use the
  same scope. Admin backfill requires explicit operator review before writes open.
- Immutable ShipmentPlan revisions require current consent from every relevant
  party; changing a revision or revoking/regranting permission invalidates old
  consent. Finalize and domain changes are atomic.
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
- Historical events keep original hash/txId/channel/proof/QR trust. Missing route
  sidecars need an independently pinned finite baseline inventory plus immutable
  exemption. A chain backfill does not establish old organizational signatures.
- Public and authenticated readers fail closed for unsupported versions or scope.
  Show recall/expiry/integrity/missing-sensor warnings alongside proof state.
- API contains no signer private key. Web signer retains a non-extractable device
  key and original signed command until outcome is known. Signer outage cannot
  downgrade a C shipment to an unsigned custody transfer.

Release tests must exercise these invariants on the exact candidate, including
concurrency, restart, restore and direct ledger verification. See
[the current release gates](plans/hybrid-production-readiness-2026-10-13.md).
