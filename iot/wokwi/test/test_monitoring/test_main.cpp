#include "monitoring.h"
#include <cassert>
#include <cstdio>
#include <limits>

agri::Sample sample(unsigned id, int64_t at = 1000) {
  agri::Sample value;
  std::snprintf(value.sampleId, sizeof(value.sampleId), "00000000-0000-4000-8000-%012u", id);
  value.recordedAtMs = at;
  value.temperature = 5.2f;
  value.humidity = 74.1f;
  return value;
}

int main() {
  agri::Samples queue;
  assert(!queue.acknowledge(nullptr));
  for (unsigned i = 0; i < agri::Capacity; ++i) assert(queue.push(sample(i, i * 1000)));
  assert(!queue.push(sample(181)));
  assert(queue.size() == 180);
  assert(!queue.acknowledge(nullptr));
  assert(queue.next()->sample.recordedAtMs == 0);
  assert(!queue.acknowledge(sample(1).sampleId));
  queue.holdNext(agri::Hold::Validation);
  assert(queue.quarantined() == 1);
  assert(queue.size() == 180); // quarantine does not free RAM
  assert(queue.next()->sample.recordedAtMs == 1000);
  assert(queue.acknowledge(sample(1).sampleId));
  assert(!queue.acknowledge(sample(1).sampleId)); // repeated receipt cannot drop another sample
  assert(queue.push(sample(181, 181000)));
  queue.cutoff(178000);
  assert(queue.quarantined() == 3);
  assert(queue.next()->sample.recordedAtMs == 2000);
  assert(queue.next()->sample.temperature == 5.2f);
  for (unsigned i = 2; i <= 178; ++i) assert(queue.acknowledge(sample(i).sampleId));
  assert(queue.size() == 3 && queue.next() == nullptr);
  assert(!queue.acknowledge(sample(0).sampleId));

  // Repeated fill/drain exercises compaction and reuse, with exact payload retention.
  agri::Samples reused;
  for (unsigned round = 0; round < 100; ++round) {
    for (unsigned i = 0; i < agri::Capacity; ++i) assert(reused.push(sample(round * 180 + i)));
    for (unsigned i = 0; i < agri::Capacity; ++i) {
      const auto expectedSample = sample(round * 180 + i);
      assert(std::strcmp(reused.next()->sample.sampleId, expectedSample.sampleId) == 0);
      assert(reused.next()->sample.temperature == expectedSample.temperature);
      assert(reused.acknowledge(expectedSample.sampleId));
    }
    assert(reused.size() == 0 && reused.next() == nullptr);
  }

  agri::Button button;
  assert(!button.update(true, 0));
  assert(!button.update(false, 10));
  assert(!button.update(true, 20));
  assert(!button.update(true, 69));
  assert(button.update(true, 70));
  assert(!button.update(true, 200));
  assert(!button.update(false, 201));
  assert(!button.update(false, 251));
  assert(!button.update(true, UINT32_MAX - 20));
  assert(button.update(true, 30)); // millis rollover

  agri::Backoff backoff;
  const unsigned expected[] = {1000, 2000, 4000, 8000, 16000, 30000, 30000};
  for (auto value : expected) assert(backoff.next(0) == value);
  assert(backoff.next(250) == 30250);
  assert(backoff.next(0, 60000) == 60000);
  backoff.reset();
  assert(backoff.next(0) == 1000);
  assert(agri::validReading(-40, 0) && agri::validReading(80, 100));
  assert(!agri::validReading(81, 50));
  assert(!agri::validReading(5, -1));
  assert(!agri::validReading(std::numeric_limits<float>::quiet_NaN(), 50));
  assert(!agri::validReading(5, std::numeric_limits<float>::infinity()));
  assert(agri::actionFor(agri::Outcome::Unknown) == agri::Action::InspectSame);
  assert(agri::actionFor(agri::Outcome::Retryable) == agri::Action::RetrySame);
  assert(agri::actionFor(agri::Outcome::Unauthorized) == agri::Action::StopWrites);
  assert(agri::actionFor(agri::Outcome::Committed) == agri::Action::RemoveConfirmed);
  assert(agri::actionFor(agri::Outcome::Invalid) == agri::Action::Quarantine);
  assert(agri::actionFor(agri::Outcome::Terminal) == agri::Action::StopSampling);
  std::puts("PASS: FIFO, capacity, quarantine, cutoff, receipt identity, debounce, rollover, backoff, sensor validation, retry policy");
}
