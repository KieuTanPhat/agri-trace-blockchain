// Runs the actual Arduino setup/loop with deterministic hardware substitutes.
// This proves control flow, not Wokwi, NTP networking or physical GPIO timing.
#include "../src/main.cpp"
#include <cassert>
#include <limits>

void tick(uint32_t time) { fake::now = time; loop(); }
void press(int pin, uint32_t time) {
  fake::pins[pin] = LOW;
  tick(time);
  tick(time + 50);
  fake::pins[pin] = HIGH;
  tick(time + 51);
  tick(time + 101);
}

int main() {
  setup();
  tick(10000);
  assert(fake::reads == 0 && samples.size() == 0); // no timestamp before NTP
  assert(fake::log.find("sensor=NOT_READ") != std::string::npos);
  WiFi.state = WL_CONNECTED;
  tick(10001);
  fake::syncCallback(nullptr);
  tick(10002);
  assert(samples.size() == 1);
  const agri::Sample original = samples.next()->sample;
  press(DoorPin, 10100);
  assert(doorOpen && samples.size() == 1);
  assert(sensor.reading.temperature == 5); // button does not invent heat
  press(NetworkPin, 10300);
  assert(!networkEnabled && WiFi.state != WL_CONNECTED);
  for (unsigned t = 20002; t <= 70002; t += 10000) tick(t);
  assert(samples.size() == 7); // six samples retained during 60-second outage
  assert(std::strcmp(original.sampleId, samples.next()->sample.sampleId) == 0);
  assert(original.recordedAtMs == samples.next()->sample.recordedAtMs);
  reconnectDelay = 30250; // previous outage must not leak its backoff into manual reconnect
  press(NetworkPin, 70200);
  assert(networkEnabled && reconnectDelay == 1000);
  WiFi.state = WL_CONNECTED;
  tick(70400);
  tick(80400);
  assert(samples.size() == 7 && !clockSynced); // wait for new synchronization
  fake::syncCallback(nullptr);
  tick(80401);
  assert(samples.size() == 8);
  sensor.status = 1;
  tick(90401);
  assert(sensorError && samples.size() == 8);
  assert(fake::log.find("sensor=ERROR") != std::string::npos);
  sensor.status = 0;
  sensor.reading.temperature = std::numeric_limits<float>::quiet_NaN();
  tick(100401);
  assert(samples.size() == 8);
  sensor.reading.temperature = 5;
  tick(110401);
  assert(!sensorError && samples.size() == 9);
  press(StopPin, 110500);
  const auto beforeStop = fake::reads;
  tick(130501);
  assert(stopped && samples.size() == 9 && fake::reads == beforeStop);
  assert(fake::log.find("sampling=STOPPED") != std::string::npos);
  // New isolated fixture exercises the full queue without 30 minutes of real time.
  stopped = false;
  uint32_t time = 140501;
  while (samples.size() < agri::Capacity) { tick(time); time += 10000; }
  const auto beforeFull = fake::reads;
  tick(time);
  assert(samples.size() == 180 && fake::reads == beforeFull);
  assert(fake::log.find("sampling=QUEUE_FULL") != std::string::npos);
  assert(samples.next()->sample.recordedAtMs == original.recordedAtMs);
  assert(samples.acknowledge(original.sampleId));
  tick(time + 10000);
  assert(samples.size() == 180 && fake::reads == beforeFull + 1);
  std::puts("PASS: actual setup/loop NTP, 60s outage, buttons, reconnect reset, sensor errors, STOP, full queue and resume");
}
