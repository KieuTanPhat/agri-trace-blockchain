#!/usr/bin/env node
// Virtual IoT devices for AgriTrace demos (ADR-006).
//
// Each device behaves like real hardware: it keeps its own Ed25519 private key,
// numbers every record, buffers while out of coverage and uploads the backlog
// when the signal returns. It knows nothing about transfers or cycles; the API
// decides where each record belongs. Devices registered from here must be
// marked "simulated" in AgriTrace so every screen labels the data.
//
//   node scripts/demo/iot-simulator/simulator.mjs
//   AGRITRACE_API_URL=http://localhost:8080/api IOT_SIM_PORT=8097 node ...
//
// The control panel listens on 127.0.0.1 only.
import { createServer } from 'node:http';
import { generateKeyPairSync, createPrivateKey, sign, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from 'json-canonicalize';
import { distanceMeters, drySoil, fieldClimate, gpsError, inBox, pointAt, prepareRoute, rng, targetSpeed } from './device-models.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const API = (process.env.AGRITRACE_API_URL ?? 'http://localhost:8080/api').replace(/\/$/, '');
const PORT = Number(process.env.IOT_SIM_PORT ?? 8097);
const STATE_DIR = resolve(process.env.IOT_SIM_STATE_DIR ?? join(here, '../../../.iot-simulator'));
const STATE_FILE = join(STATE_DIR, 'state.json');
const DOMAIN = 'agritrace:iot-device:1';
const BATCH = 200;

const routes = new Map();
for (const f of await readdir(join(here, 'routes'))) {
  if (!f.endsWith('.json')) continue;
  const r = prepareRoute(JSON.parse(await readFile(join(here, 'routes', f), 'utf8')));
  routes.set(r.id, r);
}

/** @type {{devices: any[]}} */
let state = { devices: [] };
try {
  state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
} catch {
  /* first run */
}
let dirty = false;
const save = () => { dirty = true; };
setInterval(async () => {
  if (!dirty) return;
  dirty = false;
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 1));
}, 3000).unref();

function newKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}
function signBody(device, body, forged = false) {
  const message = Buffer.concat([Buffer.from(DOMAIN, 'utf8'), Buffer.from([0]), Buffer.from(canonicalize(body), 'utf8')]);
  const key = forged ? generateKeyPairSync('ed25519').privateKey : createPrivateKey(device.privateKeyPem);
  return sign(null, message, key).toString('base64url');
}
function log(device, text) {
  device.log = [`${new Date().toLocaleTimeString('vi-VN')} ${text}`, ...(device.log ?? [])].slice(0, 40);
}

async function upload(device, records, { forged = false, replay = null } = {}) {
  const kind = device.kind === 'GPS_TRACKER' ? 'positions' : 'readings';
  const body = replay ?? { deviceCode: device.deviceCode, sentAt: new Date().toISOString(), [kind]: records };
  const signature = signBody(device, body, forged);
  try {
    const res = await fetch(`${API}/iot/v2/ingest/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-signature': signature },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      device.lastError = `${res.status} ${json?.error?.message ?? json?.message ?? ''}`.trim();
      log(device, `Máy chủ từ chối: ${device.lastError}`);
      if (res.status === 401 || res.status === 403) log(device, 'Giữ dữ liệu, thử lại sau 15 giây (thiết bị đã đăng ký và đang hoạt động trong AgriTrace chưa?)');
      return { ok: false, status: res.status };
    }
    device.lastError = null;
    device.lastBody = body;
    const r = json.data ?? {};
    device.lastResult = r;
    log(device, `Gửi ${body[kind].length}: nhận ${r.accepted}, trùng ${r.duplicates}, bỏ qua ${r.ignored}, muộn ${r.late}, bất thường ${r.anomalies}, từ chối ${r.rejected}`);
    return { ok: true, status: res.status };
  } catch (e) {
    device.lastError = `Mất kết nối tới API (${e.cause?.code ?? e.message})`;
    return { ok: false, status: 0 };
  }
}

function inSignalLoss(device) {
  if (device.signal === false) return true;
  if (device.kind !== 'GPS_TRACKER' || !device.trip) return false;
  const route = routes.get(device.trip.routeId);
  const p = device.trip.position;
  return !!p && (route.zones ?? []).some((z) => z.kind === 'PASS' && z.signalLoss && inBox(p, z.box));
}

// ---- GPS tracker ----------------------------------------------------------
function stepTrip(device, at, dt) {
  const trip = device.trip;
  const route = routes.get(trip.routeId);
  const { position } = pointAt(route, trip.progress);
  trip.position = position;
  const restZone = (route.zones ?? []).find((z) => z.kind === 'REST');
  if (restZone && !trip.rested && distanceMeters(position, restZone.at) < 150) {
    trip.rested = true;
    trip.stopUntil = at.getTime() + restZone.minutes * 60_000;
  }
  const stopped = trip.manualStop || (trip.stopUntil && at.getTime() < trip.stopUntil) || trip.progress >= route.length;
  const target = stopped ? 0 : targetSpeed(route, trip.progress, position, device.id, at);
  // Gentle acceleration and braking (≈ 1 m/s²).
  const delta = target - trip.speed;
  trip.speed = Math.max(0, trip.speed + Math.sign(delta) * Math.min(Math.abs(delta), 3.6 * dt));
  trip.progress = Math.min(route.length, trip.progress + (trip.speed / 3.6) * dt);
  if (trip.progress >= route.length && !trip.arrivedAt) trip.arrivedAt = at.toISOString();
}
function gpsFix(device, at) {
  const trip = device.trip;
  const route = trip && routes.get(trip.routeId);
  const base = trip ? pointAt(route, trip.progress) : { position: device.parked ?? [10.7769, 106.7009], heading: 0 };
  const sequence = device.sequence++;
  const urban = !trip || Math.min(trip.progress, route.length - trip.progress) < 6000;
  const err = gpsError(device.id, sequence, urban);
  let lat = base.position[0] + err.dLat;
  let lng = base.position[1] + err.dLng;
  if (device.spoofNext) {
    // A spoofed receiver suddenly reports a place ~50 km away.
    lat += 0.45;
    device.spoofNext = false;
  }
  return {
    sequence,
    recordedAt: at.toISOString(),
    latitude: +lat.toFixed(6),
    longitude: +lng.toFixed(6),
    accuracyM: err.accuracy,
    speedKmh: +(trip?.speed ?? 0).toFixed(1),
    heading: +base.heading.toFixed(1) % 360,
    satellites: err.satellites,
    battery: +device.battery.toFixed(1),
  };
}
function tickGps(device, at, dt) {
  if (device.power === 'OFF') return;
  if (device.power === 'BATTERY') {
    device.battery = Math.max(0, device.battery - dt * (0.5 / 60));
    if (device.battery <= 0) {
      device.power = 'OFF';
      log(device, 'Hết pin dự phòng, thiết bị tắt');
      return;
    }
  } else device.battery = Math.min(100, device.battery + dt * (0.2 / 60));
  if (device.trip) stepTrip(device, at, dt);
  // Cold start: no fix until the receiver has locked satellites.
  if (at.getTime() - device.bootAt < 40_000) return;
  const moving = (device.trip?.speed ?? 0) > 1;
  const every = moving ? 10_000 : 120_000;
  if (at.getTime() - (device.lastFixAt ?? 0) < every) return;
  device.lastFixAt = at.getTime();
  device.queue.push(gpsFix(device, at));
}

// ---- Field sensor -----------------------------------------------------------
function readingsAt(device, at) {
  const c = fieldClimate(device.id, at, device);
  return Object.entries(c).map(([sensorType, v]) => ({ sequence: device.sequence++, sensorType, value: v.value, unit: v.unit, recordedAt: at.toISOString() }));
}
function tickField(device, at, dt) {
  if (device.power === 'OFF') return;
  device.soil = drySoil(device.id, device.soil, at, dt / 60, device.drought);
  if (at.getTime() - (device.lastFixAt ?? 0) < device.intervalSec * 1000) return;
  device.lastFixAt = at.getTime();
  device.queue.push(...readingsAt(device, at));
}

// ---- Main loop ----------------------------------------------------------------
let last = Date.now();
let busy = false;
setInterval(async () => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  const at = new Date(now);
  for (const d of state.devices) (d.kind === 'GPS_TRACKER' ? tickGps : tickField)(d, at, dt);
  if (busy) return;
  busy = true;
  try {
    for (const d of state.devices) {
      if (!d.queue.length || inSignalLoss(d) || d.power === 'OFF' || now < (d.retryAt ?? 0)) continue;
      const batch = d.queue.slice(0, BATCH);
      const r = await upload(d, batch);
      // Like real firmware: keep the backlog while the device is not (yet)
      // accepted or the server is unreachable, and retry later. Other 4xx answers
      // are the server's decision on these records, so they are not resent.
      const retry = !r.ok && (r.status === 0 || r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500);
      if (retry) {
        d.retryAt = now + 15_000;
        if (d.queue.length > 20_000) d.queue.splice(0, d.queue.length - 20_000);
      } else d.queue.splice(0, batch.length);
    }
  } finally {
    busy = false;
    save();
  }
}, 1000);

// ---- Actions ----------------------------------------------------------------------
function createDevice({ kind, name }) {
  const keys = newKeys();
  const id = randomUUID();
  const prefix = kind === 'GPS_TRACKER' ? 'SIM-GPS' : 'SIM-FIELD';
  const device = {
    id,
    kind,
    name: name || (kind === 'GPS_TRACKER' ? 'GPS xe (ảo)' : 'Cảm biến ruộng (ảo)'),
    deviceCode: `${prefix}-${id.slice(0, 8).toUpperCase()}`,
    ...keys,
    sequence: 1,
    queue: [],
    signal: true,
    power: 'MAINS',
    battery: 100,
    bootAt: Date.now(),
    soil: 42,
    drought: false,
    intervalSec: 300,
    trip: null,
    log: [],
  };
  log(device, 'Đã tạo thiết bị và khóa riêng');
  state.devices.push(device);
  save();
  return device;
}
/** Starts a trip; a past departure is replayed as if the device had been buffering since then. */
function startTrip(device, { routeId, departAt }) {
  const route = routes.get(routeId);
  if (!route) throw new Error('Không có tuyến này');
  const start = departAt ? new Date(departAt).getTime() : Date.now();
  device.trip = { routeId, startedAt: new Date(start).toISOString(), progress: 0, speed: 0, rested: false, stopUntil: null, manualStop: false, position: route.coordinates[0] };
  device.lastFixAt = 0;
  device.bootAt = Math.min(device.bootAt, start - 60_000);
  let backfilled = 0;
  for (let t = start; t < Date.now() - 1000; t += 5000) {
    const at = new Date(t);
    stepTrip(device, at, 5);
    const moving = device.trip.speed > 1;
    if (t - (device.lastFixAt ?? 0) >= (moving ? 10_000 : 120_000)) {
      device.lastFixAt = t;
      device.queue.push(gpsFix(device, at));
      backfilled++;
    }
  }
  log(device, `Xuất phát tuyến ${route.name}${backfilled ? `; ${backfilled} điểm từ lúc xuất phát được lưu tạm để gửi` : ''}`);
}
function backfillField(device, days) {
  const end = Date.now();
  const r = rng(`${device.id}:backfill`);
  let soil = 40 + r() * 8;
  for (let t = end - days * 86_400_000; t < end - 60_000; t += 30 * 60_000) {
    const at = new Date(t);
    soil = drySoil(device.id, soil, at, 30, false);
    device.soil = soil;
    device.queue.push(...readingsAt(device, at));
  }
  log(device, `Nạp lịch sử ${days} ngày (${days * 48 * 3} bản ghi, máy chủ bỏ phần trước lúc trồng)`);
}
async function action(device, a, body) {
  switch (a) {
    case 'signal_off': device.signal = false; log(device, 'Mất sóng: dữ liệu được lưu tạm'); break;
    case 'signal_on': device.signal = true; log(device, `Có sóng lại: gửi bù ${device.queue.length} bản ghi`); break;
    case 'stop': if (device.trip) { device.trip.manualStop = true; log(device, 'Xe dừng (ngoài kế hoạch)'); } break;
    case 'resume': if (device.trip) { device.trip.manualStop = false; device.trip.stopUntil = null; log(device, 'Xe chạy tiếp'); } break;
    case 'finish': if (device.trip) { device.trip.progress = routes.get(device.trip.routeId).length - 200; log(device, 'Tua tới gần điểm nhận (chỉ để demo)'); } break;
    case 'end_trip': device.parked = device.trip?.position ?? device.parked; device.trip = null; log(device, 'Kết thúc chuyến, xe đỗ'); break;
    case 'unplug': device.power = 'BATTERY'; log(device, 'Rút nguồn xe: chạy pin dự phòng'); break;
    case 'plug': device.power = 'MAINS'; device.bootAt = Date.now(); log(device, 'Cắm lại nguồn: khởi động lại, chờ bắt vệ tinh'); break;
    case 'spoof': device.spoofNext = true; log(device, 'Điểm GPS tiếp theo sẽ bị giả mạo (nhảy ~50 km)'); break;
    case 'drought': device.drought = !device.drought; log(device, device.drought ? 'Bắt đầu khô hạn nhanh' : 'Hết khô hạn'); break;
    case 'irrigate': device.soil = Math.min(62, device.soil + 22); log(device, 'Tưới: độ ẩm đất tăng'); break;
    case 'interval': device.intervalSec = Math.max(30, Number(body.seconds) || 300); log(device, `Chu kỳ đo ${device.intervalSec}s`); break;
    case 'backfill': backfillField(device, Math.min(120, Math.max(1, Number(body.days) || 30))); break;
    case 'trip': startTrip(device, body); break;
    case 'replay':
      if (!device.lastBody) throw new Error('Chưa có gói nào để gửi lại');
      log(device, 'Gửi lại nguyên gói đã ký trước đó (replay)');
      await upload(device, [], { replay: device.lastBody });
      break;
    case 'forge': {
      const records = device.kind === 'GPS_TRACKER' ? [gpsFix(device, new Date())] : readingsAt(device, new Date());
      log(device, 'Gửi gói ký bằng khóa lạ (giả mạo thiết bị)');
      await upload(device, records, { forged: true });
      break;
    }
    case 'rotate_key': Object.assign(device, newKeys()); log(device, 'Đã tạo khóa mới; nhập khóa công khai mới trong AgriTrace'); break;
    default: throw new Error('Thao tác không hỗ trợ');
  }
  save();
}

function view(d) {
  const route = d.trip && routes.get(d.trip.routeId);
  return {
    id: d.id, kind: d.kind, name: d.name, deviceCode: d.deviceCode, publicKey: d.publicKey,
    signal: !inSignalLoss(d), manualSignal: d.signal, power: d.power, battery: +d.battery.toFixed(0), queue: d.queue.length,
    sequence: d.sequence, lastError: d.lastError ?? null, lastResult: d.lastResult ?? null, log: d.log ?? [],
    soil: +d.soil.toFixed(1), drought: d.drought, intervalSec: d.intervalSec,
    trip: d.trip && {
      routeId: d.trip.routeId, routeName: route.name, startedAt: d.trip.startedAt,
      progressKm: +(d.trip.progress / 1000).toFixed(1), totalKm: +(route.length / 1000).toFixed(1),
      speed: +d.trip.speed.toFixed(0), stopped: d.trip.manualStop || (d.trip.stopUntil && Date.now() < d.trip.stopUntil), arrivedAt: d.trip.arrivedAt ?? null,
    },
  };
}

const panel = await readFile(join(here, 'panel.html'), 'utf8');
createServer(async (req, res) => {
  const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = req.method === 'POST' ? JSON.parse((await new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s)); })) || '{}') : {};
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(panel); }
    if (req.method === 'GET' && url.pathname === '/api/state')
      return send(200, { api: API, routes: [...routes.values()].map((r) => ({ id: r.id, name: r.name, km: +(r.length / 1000).toFixed(1), origin: r.origin, destination: r.destination })), devices: state.devices.map(view) });
    if (req.method === 'POST' && url.pathname === '/api/devices') {
      if (!['GPS_TRACKER', 'FIELD_SENSOR'].includes(body.kind)) return send(422, { error: 'kind' });
      return send(201, view(createDevice(body)));
    }
    const m = url.pathname.match(/^\/api\/devices\/([\w-]+)(?:\/(\w+))?$/);
    const device = m && state.devices.find((d) => d.id === m[1]);
    if (m && !device) return send(404, { error: 'Không có thiết bị' });
    if (device && req.method === 'POST' && m[2]) { await action(device, m[2], body); return send(200, view(device)); }
    if (device && req.method === 'DELETE') { state.devices = state.devices.filter((d) => d !== device); save(); return send(200, { ok: true }); }
    send(404, { error: 'Không tìm thấy' });
  } catch (e) {
    send(400, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Thiết bị ảo AgriTrace: http://127.0.0.1:${PORT}  →  API ${API}`);
  console.log(`Trạng thái và khóa thử nghiệm lưu tại ${STATE_FILE}`);
});
