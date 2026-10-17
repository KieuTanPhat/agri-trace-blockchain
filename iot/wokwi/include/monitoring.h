#pragma once
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace agri {
constexpr size_t Capacity = 180;
constexpr uint32_t SampleIntervalMs = 10000;
struct Sample {
  char sampleId[37]{};
  int64_t recordedAtMs = 0;
  float temperature = 0;
  float humidity = 0;
  bool doorOpen = false;
};
enum class Hold { None, Validation, AfterCutoff, Terminal, Reconciliation };
struct Entry {
  Sample sample;
  Hold hold = Hold::None;
};
// Single owner (Arduino loop). Quarantine occupies the original RAM slot.
class Samples {
 public:
  bool push(const Sample& sample) {
    if (size_ == Capacity) return false;
    entries_[size_].sample = sample;
    entries_[size_].hold = Hold::None;
    ++size_;
    return true;
  }
  size_t size() const { return size_; }
  size_t quarantined() const {
    size_t result = 0;
    for (size_t i = 0; i < size_; ++i) if (entries_[i].hold != Hold::None) ++result;
    return result;
  }
  const Entry* next() const {
    for (size_t i = 0; i < size_; ++i) if (entries_[i].hold == Hold::None) return &entries_[i];
    return nullptr;
  }
  bool acknowledge(const char* id);
  void holdNext(Hold reason) {
    for (size_t i = 0; i < size_; ++i) if (entries_[i].hold == Hold::None) {
      entries_[i].hold = reason;
      return;
    }
  }
  void cutoff(int64_t cutoffMs) {
    for (size_t i = 0; i < size_; ++i)
      if (entries_[i].hold == Hold::None && entries_[i].sample.recordedAtMs > cutoffMs)
        entries_[i].hold = Hold::AfterCutoff;
  }
 private:
  std::array<Entry, Capacity> entries_{};
  size_t size_ = 0;
};
inline bool validReading(float temperature, float humidity) {
  return std::isfinite(temperature) && std::isfinite(humidity) &&
    temperature >= -40 && temperature <= 80 && humidity >= 0 && humidity <= 100;
}
class Button {
 public:
  bool update(bool down, uint32_t now) {
    if (down != raw_) { raw_ = down; changed_ = now; }
    if (raw_ != stable_ && uint32_t(now - changed_) >= 50) {
      stable_ = raw_;
      return stable_;
    }
    return false;
  }
 private:
  bool raw_ = false;
  bool stable_ = false;
  uint32_t changed_ = 0;
};
class Backoff {
 public:
  uint32_t next(uint32_t random, uint32_t retryAfterMs = 0) {
    const uint32_t seconds[] = {1, 2, 4, 8, 16, 30};
    const uint32_t delay = seconds[attempt_] * 1000 + random % 251;
    if (attempt_ < 5) ++attempt_;
    return retryAfterMs > delay ? retryAfterMs : delay;
  }
  void reset() { attempt_ = 0; }
 private:
  size_t attempt_ = 0;
};
// Transport adapter must decode business error/journal state before calling this.
enum class Outcome { Committed, Retryable, Unknown, Invalid, Unauthorized, Terminal };
enum class Action { RemoveConfirmed, RetrySame, InspectSame, Quarantine, StopWrites, StopSampling };
inline Action actionFor(Outcome outcome) {
  switch (outcome) {
    case Outcome::Committed: return Action::RemoveConfirmed;
    case Outcome::Retryable: return Action::RetrySame;
    case Outcome::Unknown: return Action::InspectSame;
    case Outcome::Invalid: return Action::Quarantine;
    case Outcome::Unauthorized: return Action::StopWrites;
    case Outcome::Terminal: return Action::StopSampling;
  }
  return Action::InspectSame;
}
} // namespace agri

#include <cstring>
inline bool agri::Samples::acknowledge(const char* id) {
  // Only the exact pending head can be removed by a positive commit receipt.
  const Entry* head = next();
  if (!id || !head || std::strcmp(head->sample.sampleId, id) != 0) return false;
  const size_t index = static_cast<size_t>(head - entries_.data());
  for (size_t i = index + 1; i < size_; ++i) entries_[i - 1] = entries_[i];
  --size_;
  return true;
}
