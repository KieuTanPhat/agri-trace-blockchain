#include <Arduino.h>
#include <DHTesp.h>
#include <WiFi.h>
#include <esp_system.h>
#include <esp_sntp.h>
#include <sys/time.h>
#include <atomic>
#include "monitoring.h"
#if __has_include("agritrace_config.h")
#include "agritrace_config.h"
#else
#include "../config.example.h"
#endif

namespace {
constexpr int DoorPin = 18, NetworkPin = 19, StopPin = 21;
constexpr int GreenPin = 25, RedPin = 26;
DHTesp sensor;
agri::Samples samples;
agri::Button doorButton, networkButton, stopButton;
agri::Backoff reconnect;
bool doorOpen = false, networkEnabled = true, stopped = false, sensorError = false;
bool sensorReadAttempted = false;
bool wasConnected = false;
// NTP callback executes outside loop; only this flag is shared.
std::atomic<bool> clockSynced{false};
uint32_t lastSample = 0, lastStatus = 0, lastReconnect = 0, reconnectDelay = 1000;
char bootId[37];

void uuid(char* output) {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  snprintf(output, 37,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);
}
void synchronize(struct timeval*) { clockSynced = true; }
void collect(uint32_t now) {
  if (stopped || !clockSynced || samples.size() == agri::Capacity ||
      uint32_t(now - lastSample) < agri::SampleIntervalMs) return;
  lastSample = now;
  const TempAndHumidity reading = sensor.getTempAndHumidity();
  sensorReadAttempted = true;
  sensorError = sensor.getStatus() != 0 || !agri::validReading(reading.temperature, reading.humidity);
  if (sensorError) { Serial.println("SENSOR_ERROR: no sample created"); return; }
  timeval measured{};
  gettimeofday(&measured, nullptr);
  agri::Sample sample;
  uuid(sample.sampleId);
  sample.recordedAtMs = int64_t(measured.tv_sec) * 1000 + measured.tv_usec / 1000;
  sample.temperature = reading.temperature;
  sample.humidity = reading.humidity;
  sample.doorOpen = doorOpen;
  samples.push(sample);
  Serial.printf("LOCAL_SAMPLE source=WOKWI_SIMULATED sampleId=%s recordedAtMs=%lld temperature=%.1f humidity=%.1f door=%s pending=%u\n",
    sample.sampleId, static_cast<long long>(sample.recordedAtMs),
    sample.temperature, sample.humidity, doorOpen ? "open" : "closed", unsigned(samples.size()));
  if (samples.size() == agri::Capacity) Serial.println("QUEUE_FULL: sampling paused; all samples retained");
}
} // namespace

void setup() {
  Serial.begin(115200);
  pinMode(DoorPin, INPUT_PULLUP);
  pinMode(NetworkPin, INPUT_PULLUP);
  pinMode(StopPin, INPUT_PULLUP);
  pinMode(GreenPin, OUTPUT);
  pinMode(RedPin, OUTPUT);
  sensor.setup(4, DHTesp::DHT22);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.begin(AGRI_WIFI_SSID, AGRI_WIFI_PASSWORD);
  uuid(bootId);
  sntp_set_time_sync_notification_cb(synchronize);
  configTime(0, 0, AGRI_NTP_SERVER);
  Serial.printf("BOOT %s | STANDALONE: no API transport, no server heartbeat or receipt\n", bootId);
}

void loop() {
  const uint32_t now = millis();
  if (doorButton.update(digitalRead(DoorPin) == LOW, now)) {
    doorOpen = !doorOpen;
    Serial.println(doorOpen ? "DOOR_OPEN" : "DOOR_CLOSED");
  }
  if (stopButton.update(digitalRead(StopPin) == LOW, now)) {
    stopped = true;
    Serial.println("SAMPLING_STOPPED: queue retained; reset loses RAM");
  }
  if (networkButton.update(digitalRead(NetworkPin) == LOW, now)) {
    networkEnabled = !networkEnabled;
    if (!networkEnabled) WiFi.disconnect(false, false);
    else {
      WiFi.begin(AGRI_WIFI_SSID, AGRI_WIFI_PASSWORD);
      lastReconnect = now;
      reconnect.reset();
      reconnectDelay = 1000;
    }
    Serial.println(networkEnabled ? "WIFI_ENABLED" : "WIFI_DISABLED");
  }
  const bool connected = networkEnabled && WiFi.status() == WL_CONNECTED;
  if (connected && !wasConnected) {
    clockSynced = false;
    configTime(0, 0, AGRI_NTP_SERVER);
    reconnect.reset();
    reconnectDelay = 1000;
    lastReconnect = now;
  }
  if (networkEnabled && !connected && uint32_t(now - lastReconnect) >= reconnectDelay) {
    WiFi.reconnect();
    lastReconnect = now;
    reconnectDelay = reconnect.next(esp_random());
  }
  wasConnected = connected;
  collect(now);
  digitalWrite(GreenPin, connected ? HIGH : LOW);
  digitalWrite(RedPin, (!clockSynced || sensorError || samples.size() == agri::Capacity || !connected) ? HIGH : LOW);
  if (uint32_t(now - lastStatus) >= 10000) {
    lastStatus = now;
    const char* sampling = stopped ? "STOPPED" :
      samples.size() == agri::Capacity ? "QUEUE_FULL" :
      !clockSynced ? "WAIT_NTP" : "RUNNING";
    Serial.printf("LOCAL_STATUS bootId=%s clock=%s sampling=%s sensor=%s pending=%u quarantine=%u transport=NOT_INTEGRATED\n",
      bootId, clockSynced ? "SYNCED" : "WAIT_NTP", sampling,
      !sensorReadAttempted ? "NOT_READ" : sensorError ? "ERROR" : "OK",
      unsigned(samples.size() - samples.quarantined()), unsigned(samples.quarantined()));
  }
  delay(1);
}
