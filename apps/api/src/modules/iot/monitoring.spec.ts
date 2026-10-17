import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  DEMO_MONITORING_POLICY,
  monitoringPolicyDigest,
  normalizeMonitoringPolicy,
  sensorMilli,
} from './monitoring-policy.js';
import {
  evaluateMonitoring,
  type MonitoringReading,
  type MonitoringWindow,
} from './monitoring-evaluator.js';
import {
  buildMonitoringEvidence,
  verifyMonitoringEvidence,
  monitoringReviewSummary,
  unmonitoredReviewSummary,
  requireMonitoringReceiptReview,
  type MonitoringSnapshot,
} from './monitoring-evidence.js';
import { monitoringFinalization } from './monitoring-lifecycle.js';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (seconds: number) =>
  new Date(Date.UTC(2026, 9, 17) + seconds * 1000).toISOString();
const window: MonitoringWindow = {
  sessionId: id(1),
  deviceId: id(2),
  shipmentId: id(3),
  periodStart: at(0),
  cutoffAt: at(130),
  policy: { ...DEMO_MONITORING_POLICY },
};
function reading(
  n: number,
  seconds = n * 10,
  temperature = '9.000',
): MonitoringReading {
  return {
    id: id(100 + n),
    sampleId: id(1000 + n),
    sessionId: id(1),
    deviceId: id(2),
    shipmentId: id(3),
    recordedAt: at(seconds),
    temperature,
    humidity: '74.000',
    doorOpen: false,
    latitude: null,
    longitude: null,
  };
}
const samples = () => Array.from({ length: 13 }, (_, n) => reading(n));
function snapshot(): MonitoringSnapshot {
  return {
    ...window,
    planId: id(4),
    planRevision: 1,
    policyDigest: monitoringPolicyDigest('ENABLED', window.policy),
    sourceType: 'WOKWI_SIMULATED',
    completeness: 'COMPLETE',
  };
}

describe('monitoring policy and evaluation candidate', () => {
  it('normalizes Decimal values without binary float accumulation', () => {
    expect(
      normalizeMonitoringPolicy({ ...window.policy, temperatureMinC: '2' }),
    ).toEqual(window.policy);
    const result = evaluateMonitoring(window, [
      reading(0, 0, '0.100'),
      reading(1, 10, '0.200'),
    ]);
    expect(result.summary.temperature).toEqual({
      min: '0.100',
      max: '0.200',
      average: '0.150',
    });
    expect(
      evaluateMonitoring(window, [reading(0, 0, '-0.001'), reading(1, 10, '0')])
        .summary.temperature?.average,
    ).toBe('-0.001');
  });
  it.each(['NaN', 'Infinity', '1.0001', '1e2', ''])(
    'rejects invalid/overprecise decimal %s',
    (value) => {
      expect(() => sensorMilli(value)).toThrow(UnprocessableEntityException);
    },
  );
  it('rejects contradictory policy and changes its digest when criteria change', () => {
    expect(() =>
      normalizeMonitoringPolicy({ ...window.policy, temperatureMinC: '8' }),
    ).toThrow();
    expect(() => monitoringPolicyDigest('NONE', window.policy)).toThrow();
    expect(
      monitoringPolicyDigest('ENABLED', {
        ...window.policy,
        temperatureMaxC: '9',
      }),
    ).not.toBe(snapshot().policyDigest);
    expect(() => monitoringPolicyDigest('ENABLED', null)).toThrow();
  });
  it('requires 120 seconds of measured excursion; never counts time to cutoff as evidence', () => {
    expect(
      evaluateMonitoring(window, samples().slice(0, 12)).summary.episodes,
    ).toEqual([]);
    expect(evaluateMonitoring(window, samples()).summary.episodes).toEqual([
      {
        type: 'TEMPERATURE_EXCURSION',
        startedAt: at(0),
        lastEvidenceAt: at(120),
        durationMs: 120000,
      },
    ]);
  });
  it('breaks excursions across a gap over 20 seconds and includes edge gaps', () => {
    const rows = [...samples().slice(0, 6), ...samples().slice(9)];
    const result = evaluateMonitoring(
      { ...window, cutoffAt: at(200) },
      rows,
    ).summary;
    expect(result.episodes).toEqual([]);
    expect(result.gaps).toEqual([
      { from: at(50), to: at(90), durationMs: 40000 },
      { from: at(120), to: at(200), durationMs: 80000 },
    ]);
    expect(
      evaluateMonitoring(window, samples().slice(3)).summary.gaps[0].from,
    ).toBe(at(0));
  });
  it('allows exactly 20-second spacing and ends a run on an in-range sample', () => {
    const rows = Array.from({ length: 7 }, (_, n) => reading(n, n * 20));
    expect(evaluateMonitoring(window, rows).summary.episodes).toHaveLength(1);
    rows[3] = reading(3, 60, '8');
    expect(evaluateMonitoring(window, rows).summary.episodes).toHaveLength(0);
  });
  it('re-evaluates backfill deterministically without mutating raw rows', () => {
    const rows = samples().reverse();
    const before = structuredClone(rows);
    expect(evaluateMonitoring(window, rows)).toEqual(
      evaluateMonitoring(window, samples()),
    );
    expect(rows).toEqual(before);
    const sameTime = [reading(1, 0, '2'), reading(0, 0, '8')];
    expect(
      evaluateMonitoring(window, sameTime).readings.map((r) => r.sampleId),
    ).toEqual([id(1000), id(1001)]);
  });
  it.each([
    { deviceId: id(99) },
    { sessionId: id(99) },
    { shipmentId: id(99) },
    { recordedAt: at(-1) },
    { recordedAt: at(131) },
    { recordedAt: '2026-02-30T00:00:00Z' },
    { temperature: '80.001' },
    { humidity: '-0.001' },
    { latitude: '1' },
    { latitude: '91', longitude: '0' },
    { latitude: '1.0000001', longitude: '0' },
  ])('rejects invalid row %j', (patch) => {
    expect(() =>
      evaluateMonitoring(window, [{ ...reading(0), ...patch }]),
    ).toThrow();
  });
  it('rejects duplicate memberships/sample IDs and accepts a complete GPS pair', () => {
    expect(() =>
      evaluateMonitoring(window, [reading(0), reading(0)]),
    ).toThrow();
    expect(() =>
      evaluateMonitoring(window, [
        reading(0),
        { ...reading(1), sampleId: reading(0).sampleId },
      ]),
    ).toThrow();
    expect(
      evaluateMonitoring(window, [
        { ...reading(0), latitude: '10.1', longitude: '106.2' },
      ]).readings[0].latitude,
    ).toBe('10.100000');
  });
});

describe('monitoring evidence candidate', () => {
  it('requires explicit missing-data acknowledgement when the plan chose NONE', () => {
    const summary = unmonitoredReviewSummary(id(3), id(4), 1);
    const input = {
      reviewedSummaryHash: canonicalSha256(summary),
      acknowledgedWarnings: false,
      acknowledgedMissingData: false,
    };
    expect(() => requireMonitoringReceiptReview(summary, input)).toThrow();
    expect(
      requireMonitoringReceiptReview(summary, {
        ...input,
        acknowledgedMissingData: true,
      }).acceptanceReason,
    ).toBeNull();
  });
  it('verifies canonical membership and source without depending on ingestion order', () => {
    const evidence = buildMonitoringEvidence(snapshot(), samples());
    expect(evidence.digestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyMonitoringEvidence(snapshot(), samples().reverse(), evidence),
    ).toBe(true);
    expect(
      verifyMonitoringEvidence(
        snapshot(),
        [reading(0, 0, '8'), ...samples().slice(1)],
        evidence,
      ),
    ).toBe(false);
    expect(
      verifyMonitoringEvidence(snapshot(), samples().slice(1), evidence),
    ).toBe(false);
  });
  it('detects tampered summary, source, door state, membership and policy', () => {
    const evidence = buildMonitoringEvidence(snapshot(), samples());
    for (const mutate of [
      (value: typeof evidence) => {
        value.payload.summary.readingCount = 999;
      },
      (value: typeof evidence) => {
        value.payload.membership[0].doorOpen = true;
      },
      (value: typeof evidence) => {
        value.payload.policy.temperatureMaxC = '10';
      },
      (value: typeof evidence) => {
        value.payload.membership.pop();
      },
      (value: typeof evidence) => {
        value.payload.planRevision = 2;
      },
    ]) {
      const changed = structuredClone(evidence);
      mutate(changed);
      expect(verifyMonitoringEvidence(snapshot(), samples(), changed)).toBe(
        false,
      );
    }
    expect(
      verifyMonitoringEvidence(snapshot(), samples(), {
        ...evidence,
        extra: 'uncommitted',
      }),
    ).toBe(false);
    expect(verifyMonitoringEvidence(snapshot(), samples(), null)).toBe(false);
  });
  it('does not synthesize a digest for zero readings or mark gaps complete', () => {
    const empty = { ...snapshot(), completeness: 'NO_DATA' as const };
    const evidence = buildMonitoringEvidence(empty, []);
    expect(evidence.digestHash).toBeNull();
    expect(evidence.payload.summary.temperature).toBeNull();
    expect(verifyMonitoringEvidence(empty, [], evidence)).toBe(true);
    expect(() => buildMonitoringEvidence(snapshot(), [])).toThrow();
    expect(() => buildMonitoringEvidence(snapshot(), [reading(0)])).toThrow();
  });
  it('keeps raw/GPS/door/actions out of the receive summary', () => {
    const summary = monitoringReviewSummary(
      buildMonitoringEvidence(snapshot(), samples()),
    );
    expect(summary).not.toHaveProperty('membership');
    expect(JSON.stringify(summary)).not.toMatch(
      /latitude|longitude|doorOpen|acceptanceReason|proofStatus/,
    );
  });
  it('requires both acknowledgements and reason when both warning and missing data apply', () => {
    const summary = monitoringReviewSummary(
      buildMonitoringEvidence(
        { ...snapshot(), completeness: 'INCOMPLETE' },
        samples(),
      ),
    );
    const input = {
      reviewedSummaryHash: canonicalSha256(summary),
      acknowledgedWarnings: true,
      acknowledgedMissingData: true,
      acceptanceReason: ' Đã kiểm tra khi giao nhận ',
    };
    expect(
      requireMonitoringReceiptReview(summary, input).acceptanceReason,
    ).toBe('Đã kiểm tra khi giao nhận');
    for (const patch of [
      { acknowledgedWarnings: false },
      { acknowledgedMissingData: false },
      { acceptanceReason: ' ' },
    ])
      expect(() =>
        requireMonitoringReceiptReview(summary, { ...input, ...patch }),
      ).toThrow(UnprocessableEntityException);
    expect(() =>
      requireMonitoringReceiptReview({ ...summary, readingCount: 9 }, input),
    ).toThrow(ConflictException);
  });
});

describe('monitoring finalization decision', () => {
  const complete = () => ({
    state: 'DRAINING' as const,
    cutoffAt: at(120),
    now: at(130),
    contactTimeoutSeconds: 30,
    readingCount: 13,
    hasDataGap: false,
    sensorError: false,
    bootChanged: false,
    allowIncomplete: false,
    heartbeat: {
      receivedAt: at(125),
      samplingStopped: true,
      pendingCount: 0,
      quarantineCount: 0,
    },
  });
  it('requires a fresh post-cutoff stop confirmation and empty queue for complete', () => {
    expect(monitoringFinalization(complete()).completeness).toBe('COMPLETE');
    for (const patch of [
      { receivedAt: at(100) },
      { pendingCount: 1 },
      { quarantineCount: 1 },
      { samplingStopped: false },
    ])
      expect(() =>
        monitoringFinalization({
          ...complete(),
          heartbeat: { ...complete().heartbeat, ...patch },
        }),
      ).toThrow(ConflictException);
    expect(() =>
      monitoringFinalization({ ...complete(), now: at(156) }),
    ).toThrow(ConflictException);
  });
  it('permits explicit incomplete finalization after interruption with a reason', () => {
    expect(
      monitoringFinalization({
        ...complete(),
        state: 'INTERRUPTED',
        heartbeat: null,
        allowIncomplete: true,
        reason: 'Thiết bị mất liên lạc',
      }).completeness,
    ).toBe('INCOMPLETE');
    expect(() =>
      monitoringFinalization({ ...complete(), state: 'RUNNING' }),
    ).toThrow();
    expect(() =>
      monitoringFinalization({ ...complete(), state: 'FINALIZED' }),
    ).toThrow();
    expect(() =>
      monitoringFinalization({ ...complete(), bootChanged: true }),
    ).toThrow();
    expect(() =>
      monitoringFinalization({
        ...complete(),
        heartbeat: { ...complete().heartbeat, receivedAt: at(999) },
      }),
    ).toThrow();
  });
});
