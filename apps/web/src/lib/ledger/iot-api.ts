import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";

type S = components["schemas"];
/** ADR-006 device registry and read models. The server remains the authority. */
export type DeviceKind = "FIELD_SENSOR" | "GPS_TRACKER";
export type Device = {
  id: string;
  deviceCode: string;
  name: string;
  type: DeviceKind;
  status: "ACTIVE" | "INACTIVE";
  simulated: boolean;
  authorityRevision: number;
  lastSeenAt: string | null;
  createdAt: string;
  plotId: string | null;
  vehicleId: string | null;
  publicKey: string | null;
  online: boolean;
  plot: { id: string; name: string; farm: { id: string; name: string } } | null;
  vehicle: { id: string; registration: string; kind: string } | null;
  runningCycles: { id: string; cycleCode: string }[];
  activeTransfer: { id: string; origin: string; destination: string } | null;
};
export type DeviceDetail = Device & {
  keyFingerprint: string | null;
  recordsLast24h: number;
  // FIELD_SENSOR
  latest?: { sensorType: string; value: number; unit: string; recordedAt: string }[];
  recent?: unknown[];
  // GPS_TRACKER
  latestPosition?: GpsRecord | null;
};
export type FieldRecord = { sequence: string | null; sensorType: string; value: number; unit: string; recordedAt: string; ingestTime: string; cycles: { id: string; cycleCode: string }[] };
export type GpsRecord = { sequence: string; recordedAt: string; receivedAt: string; latitude: number; longitude: number; accuracyM: number | null; speedKmh: number | null; heading: number | null; satellites: number | null; battery: number | null; validity: "VALID" | "ANOMALY" | "LATE"; anomalyCode: string | null; transferId: string };
export type DeviceOptions = {
  plots: { id: string; name: string; farm: { id: string; name: string } }[];
  /** inTransit: carrying a transfer now; trackerId: active GPS already on it. */
  vehicles: { id: string; registration: string; kind: string; inTransit: boolean; trackerId: string | null; trackerName: string | null }[];
};
export type SensorSeries = {
  sensorType: string;
  unit: string;
  latest: { value: number; recordedAt: string } | null;
  points: { t: string; avg: number; min: number; max: number }[];
};
export type CycleReadings = {
  cycleId: string;
  simulated: boolean;
  readingCount: number;
  lateCount: number;
  bucketMinutes: number;
  devices: { id: string; deviceCode: string; name: string; status: string; simulated: boolean; lastSeenAt: string | null; online: boolean }[];
  series: SensorSeries[];
};
export type RoutePoint = {
  sequence: string;
  recordedAt: string;
  receivedAt: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
  validity: "VALID" | "ANOMALY" | "LATE";
  anomalyCode: string | null;
};
export type RouteWarning = { code: "SIGNAL_GAP" | "LONG_STOP" | "ANOMALY_POINTS"; from?: string; to?: string; seconds?: number };
/** source SITE: the site's map point; PROVINCE: representative province point. */
export type MapPlace = { name: string; latitude: number | null; longitude: number | null; source?: "SITE" | "PROVINCE" | null } | null;
export type TransferRoute = {
  transferId: string;
  status: string;
  transportMode: string;
  trackable: boolean;
  vehicle: { id: string; registration: string; kind: string } | null;
  tracker: { id: string; deviceCode: string; name: string; simulated: boolean; lastSeenAt: string | null } | null;
  source: "DEVICE" | "SIMULATED" | "NONE";
  window: { inTransitAt: string | null; deliveredAt: string | null };
  origin: MapPlace;
  destination: MapPlace;
  planned: { distanceM: number; durationS: number; estimated: boolean } | null;
  arrived: boolean;
  lastPosition: { recordedAt: string; latitude: number; longitude: number; speedKmh: number | null; heading: number | null; battery: number | null } | null;
  summary: { pointCount: number; anomalyCount: number; distanceM: number; coveragePercent: number; maxGapSeconds: number } | null;
  warnings: RouteWarning[];
  seal: { digestHash: string; source: string; pointCount: number; distanceM: number; coveragePercent: string; createdAt: string } | null;
  points: RoutePoint[];
};

const root = "/iot/v2";
const enc = encodeURIComponent;
const post = (path: string, body: unknown, cmd: LedgerCommandContext) =>
  ledgerRequest<S["WorkspaceRecordDto"]>(root + path, { method: "POST", headers: { "Idempotency-Key": cmd.idempotencyKey }, body: JSON.stringify(body) });

export const iotApi = {
  devices: async () => (await ledgerRequest<{ items: Device[] }>(root + "/devices")).items,
  options: async () => (await ledgerRequest<DeviceOptions>(root + "/device-options")),
  device: (id: string) => ledgerRequest<DeviceDetail>(`${root}/devices/${enc(id)}`),
  register: (input: S["RegisterDeviceInput"], cmd: LedgerCommandContext) => post("/devices", input, cmd),
  bind: (id: string, input: S["BindDeviceInput"], cmd: LedgerCommandContext) => post(`/devices/${enc(id)}/binding`, input, cmd),
  rotateKey: (id: string, input: S["RotateDeviceKeyInput"], cmd: LedgerCommandContext) => post(`/devices/${enc(id)}/key`, input, cmd),
  setStatus: (id: string, input: S["DeviceStatusInput"], cmd: LedgerCommandContext) => post(`/devices/${enc(id)}/status`, input, cmd),
  cycleReadings: (cycleId: string, hours?: number) =>
    ledgerRequest<CycleReadings>(`${root}/cycles/${enc(cycleId)}/readings${hours ? `?hours=${hours}` : ""}`),
  transferRoute: async (transferId: string) =>
    (await ledgerRequest<{ record: TransferRoute }>(`/distribution/transfers/${enc(transferId)}/route`)).record,
};
