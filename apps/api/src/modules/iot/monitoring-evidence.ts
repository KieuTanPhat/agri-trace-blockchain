import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  evaluateMonitoring,
  monitoringInstant,
  type MonitoringReading,
  type MonitoringWindow,
} from './monitoring-evaluator.js';
import {
  monitoringPolicyDigest,
  normalizeMonitoringPolicy,
} from './monitoring-policy.js';

export interface MonitoringSnapshot extends MonitoringWindow {
  planId: string;
  planRevision: number;
  policyDigest: string;
  sourceType: 'WOKWI_SIMULATED';
  completeness: 'COMPLETE' | 'INCOMPLETE' | 'NO_DATA';
}

/** Candidate v2 payload only. No mutation of historical digest-1 or Hybrid envelopes. */
export function buildMonitoringEvidence(
  snapshot: MonitoringSnapshot,
  rows: readonly MonitoringReading[],
) {
  if (
    !isUUID(snapshot.planId) ||
    !Number.isSafeInteger(snapshot.planRevision) ||
    snapshot.planRevision < 1 ||
    snapshot.sourceType !== 'WOKWI_SIMULATED' ||
    snapshot.policyDigest !==
      monitoringPolicyDigest('ENABLED', snapshot.policy) ||
    !['COMPLETE', 'INCOMPLETE', 'NO_DATA'].includes(snapshot.completeness)
  )
    throw new UnprocessableEntityException(
      'Snapshot giám sát không khớp revision/policy/source',
    );
  const evaluated = evaluateMonitoring(snapshot, rows);
  if (
    (rows.length === 0) !== (snapshot.completeness === 'NO_DATA') ||
    (snapshot.completeness === 'COMPLETE' && evaluated.summary.gaps.length > 0)
  )
    throw new UnprocessableEntityException('Completeness không khớp tập mẫu');
  const payload = {
    schemaVersion: 'shipment-telemetry-digest-2' as const,
    sessionId: snapshot.sessionId,
    deviceId: snapshot.deviceId,
    shipmentId: snapshot.shipmentId,
    planId: snapshot.planId,
    planRevision: snapshot.planRevision,
    policyDigest: snapshot.policyDigest,
    sourceType: snapshot.sourceType,
    policy: normalizeMonitoringPolicy(snapshot.policy),
    periodStart: new Date(
      monitoringInstant(snapshot.periodStart),
    ).toISOString(),
    cutoffAt: new Date(monitoringInstant(snapshot.cutoffAt)).toISOString(),
    completeness: snapshot.completeness,
    membership: evaluated.readings,
    summary: evaluated.summary,
  };
  return {
    payload,
    digestHash: rows.length === 0 ? null : canonicalSha256(payload),
  };
}
export type MonitoringEvidence = ReturnType<typeof buildMonitoringEvidence>;
export type MonitoringReviewSummary =
  | ReturnType<typeof monitoringReviewSummary>
  | ReturnType<typeof unmonitoredReviewSummary>;

export function unmonitoredReviewSummary(
  shipmentId: string,
  planId: string,
  planRevision: number,
) {
  if (
    !isUUID(shipmentId) ||
    !isUUID(planId) ||
    !Number.isSafeInteger(planRevision) ||
    planRevision < 1
  )
    throw new UnprocessableEntityException(
      'Kế hoạch không giám sát không hợp lệ',
    );
  return {
    schemaVersion: 'shipment-monitoring-review-1',
    monitoringMode: 'NONE',
    shipmentId,
    sessionId: null,
    planId,
    planRevision,
    policyDigest: monitoringPolicyDigest('NONE', null),
    source: null,
    periodStart: null,
    cutoffAt: null,
    completeness: 'NOT_MONITORED' as const,
    readingCount: 0,
    firstRecordedAt: null,
    lastRecordedAt: null,
    temperature: null,
    episodes: [],
    gaps: [],
  };
}

/** Snapshot must be fetched independently from the immutable session/plan, not supplied by the claimant. */
export function verifyMonitoringEvidence(
  snapshot: MonitoringSnapshot,
  rows: readonly MonitoringReading[],
  stored: unknown,
): boolean {
  try {
    return (
      canonicalSha256(stored) ===
      canonicalSha256(buildMonitoringEvidence(snapshot, rows))
    );
  } catch {
    return false;
  }
}

export function monitoringReviewSummary(evidence: MonitoringEvidence) {
  const { payload } = evidence;
  // Deliberately excludes proof progress, live heartbeat, raw/GPS and private actions.
  return {
    schemaVersion: 'shipment-monitoring-review-1',
    monitoringMode: 'ENABLED',
    sessionId: payload.sessionId,
    shipmentId: payload.shipmentId,
    planId: payload.planId,
    planRevision: payload.planRevision,
    policyDigest: payload.policyDigest,
    source: payload.sourceType,
    periodStart: payload.periodStart,
    cutoffAt: payload.cutoffAt,
    completeness: payload.completeness,
    ...payload.summary,
  };
}

export interface MonitoringReceiptInput {
  reviewedSummaryHash: string;
  acknowledgedWarnings: boolean;
  acknowledgedMissingData: boolean;
  acceptanceReason?: string;
}

/** Call inside the receive transaction after recomputing the summary under the Lot lock. */
export function requireMonitoringReceiptReview(
  reviewSummary: MonitoringReviewSummary,
  input: MonitoringReceiptInput,
) {
  const summaryHash = canonicalSha256(reviewSummary);
  if (input.reviewedSummaryHash !== summaryHash)
    throw new ConflictException(
      'Bản tổng hợp giám sát đã thay đổi; cần xem lại',
    );
  const reason = input.acceptanceReason?.trim() ?? '';
  const warnings = reviewSummary.episodes.length > 0;
  const missingData = reviewSummary.completeness !== 'COMPLETE';
  if (
    (warnings && (input.acknowledgedWarnings !== true || !reason)) ||
    (missingData && input.acknowledgedMissingData !== true)
  )
    throw new UnprocessableEntityException(
      'Cần xác nhận cảnh báo/thiếu dữ liệu và lý do nhận hàng khi có cảnh báo',
    );
  return {
    reviewSummary,
    reviewedSummaryHash: summaryHash,
    acknowledgedWarnings: input.acknowledgedWarnings === true,
    acknowledgedMissingData: input.acknowledgedMissingData === true,
    acceptanceReason: reason || null,
  };
}
