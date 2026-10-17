#pragma once
#include "Arduino.h"
constexpr int WIFI_STA = 1, WL_CONNECTED = 3;
struct Wifi {
  int state = 0;
  void mode(int) {}
  void setAutoReconnect(bool) {}
  void begin(const char*, const char*) { ++fake::begins; }
  void disconnect(bool, bool) { state = 0; }
  void reconnect() { ++fake::reconnects; }
  int status() { return state; }
} WiFi;
