import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureId, validateTarget } from "./seed-ui.mjs";
const env = { NODE_ENV: "test", AGRITRACE_UI_SEED: "local-test-only", TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1:5433/agri_trace_ui_test", UI_SEED_PASSWORD: "local-test-only-example" };
test("seed only accepts the explicitly isolated local database", () => {
  assert.ok(validateTarget(env));
  for (const patch of [
    { NODE_ENV: "production" }, { AGRITRACE_UI_SEED: "" },
    { TEST_DATABASE_URL: "postgresql://test:test@db.example.com/agri_trace_ui_test" },
    { TEST_DATABASE_URL: "postgresql://test:test@localhost/agri_trace" },
    { TEST_DATABASE_URL: `${env.TEST_DATABASE_URL}?host=remote` }, { UI_SEED_PASSWORD: "short" },
  ]) assert.throws(() => validateTarget({ ...env, ...patch }));
});
test("stable UUIDs support reruns without duplicate fixture records", () => {
  assert.equal(fixtureId("processor"), fixtureId("processor"));
  assert.notEqual(fixtureId("processor"), fixtureId("farm"));
  assert.match(fixtureId("processor"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
