#pragma once
#include "Arduino.h"
inline void sntp_set_time_sync_notification_cb(void (*callback)(timeval*)) {
  fake::syncCallback = callback;
}
