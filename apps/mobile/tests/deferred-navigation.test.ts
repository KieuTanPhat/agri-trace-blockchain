import assert from "node:assert/strict";
import test from "node:test";
import { deferAuthNavigation, type NavigationScheduler } from "../src/auth/deferred-navigation";

function fixture() {
  const jobs: { callback: () => void; cancelled: boolean; kind: string }[] = [];
  function add(kind: string, callback: () => void) {
    const job = { kind, callback, cancelled: false };
    jobs.push(job);
    return () => { job.cancelled = true; };
  }
  const clock: NavigationScheduler = {
    delay(callback, milliseconds) {
      assert.equal(milliseconds, 300);
      return add("delay", callback);
    },
    frame: callback => add("frame", callback),
  };
  return { clock, jobs };
}

test("navigation waits for settling delay and two frames, then runs only once", () => {
  const { clock, jobs } = fixture();
  let calls = 0;
  deferAuthNavigation(() => { calls++; }, clock);
  assert.equal(calls, 0);
  jobs[0].callback();
  assert.equal(calls, 0);
  jobs[1].callback();
  assert.equal(calls, 0);
  jobs[2].callback();
  jobs[2].callback();
  assert.equal(calls, 1);
  assert.deepEqual(jobs.map(job => job.kind), ["delay", "frame", "frame"]);
});

for (const stage of [0, 1, 2]) {
  test(`blur/unmount/status change cancels pending navigation at stage ${stage}`, () => {
    const { clock, jobs } = fixture();
    let calls = 0;
    const cancel = deferAuthNavigation(() => { calls++; }, clock);
    for (let index = 0; index < stage; index++) jobs[index].callback();
    cancel();
    assert.equal(jobs[stage].cancelled, true);
    // Even a callback already queued by native code must not navigate late.
    jobs[stage].callback();
    assert.equal(calls, 0);
    assert.equal(jobs.length, stage + 1);
  });
}
