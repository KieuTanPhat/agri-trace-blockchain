#pragma once
#include "Arduino.h"
struct TempAndHumidity { float temperature = 5; float humidity = 74; };
class DHTesp {
 public:
  enum { DHT22 };
  int status = 0;
  TempAndHumidity reading;
  void setup(int, int) {}
  int getStatus() { return status; }
  TempAndHumidity getTempAndHumidity() { ++fake::reads; return reading; }
};
