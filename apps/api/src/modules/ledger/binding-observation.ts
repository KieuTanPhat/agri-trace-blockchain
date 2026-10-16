/** Non-secret operational projection. An observation is neither a ledger
 * proof nor permission; a missing/stale heartbeat must remain visible. */
export function bindingObservation(row: {
  lastCheckedAt: Date;
  lastHealthyAt: Date | null;
  lastErrorCode: string | null;
  certificateExpiresAt: Date | null;
} | null | undefined, now = new Date()) {
  const configured = Number(process.env.WORKER_HEALTH_MAX_AGE_MS ?? 60_000);
  const maxAge = Number.isFinite(configured) && configured > 0 ? configured : 60_000;
  const heartbeatStale = !row || !row.lastHealthyAt ||
    row.lastHealthyAt.getTime() > now.getTime() + 5_000 ||
    now.getTime() - row.lastHealthyAt.getTime() > maxAge;
  const certificateExpired = Boolean(row?.certificateExpiresAt && row.certificateExpiresAt <= now);
  return {
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastHealthyAt: row?.lastHealthyAt ?? null,
    lastErrorCode: row?.lastErrorCode ?? null,
    certificateExpiresAt: row?.certificateExpiresAt ?? null,
    heartbeatStale,
    certificateExpired,
    healthy: Boolean(row?.certificateExpiresAt && !heartbeatStale && !certificateExpired && !row.lastErrorCode),
  };
}
