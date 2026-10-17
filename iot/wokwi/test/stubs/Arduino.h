#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <string>
#include <array>
#include <sys/time.h>
constexpr int LOW = 0, HIGH = 1, INPUT_PULLUP = 2, OUTPUT = 3;
namespace fake {
uint32_t now = 0;
std::array<int, 40> pins{};
std::string log;
unsigned reads = 0, begins = 0, reconnects = 0, syncs = 0;
void (*syncCallback)(timeval*) = nullptr;
}
struct SerialPort {
  void begin(int) {}
  void println(const char* text) { fake::log += text; fake::log += '\n'; }
  void printf(const char* format, ...) {
    char buffer[1024];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);
    fake::log += buffer;
  }
} Serial;
inline uint32_t millis() { return fake::now; }
inline void delay(unsigned) {}
inline void pinMode(int pin, int mode) { if (mode == INPUT_PULLUP) fake::pins[pin] = HIGH; }
inline int digitalRead(int pin) { return fake::pins[pin]; }
inline void digitalWrite(int pin, int value) { fake::pins[pin] = value; }
inline void configTime(int, int, const char*) { ++fake::syncs; }
