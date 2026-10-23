import { test as base, expect } from "@playwright/test";
import { actorSession, type ActorKey } from "./fixtures/actors";
import { defaultAuthResponse } from "./fixtures/auth";
import {
  readScenario,
  type CapturedRequest,
  type FixtureState,
} from "./fixtures/scenarios";
export type { ActorKey, CapturedRequest };
export interface LedgerApiFixture {
  useActor(actor: ActorKey): Promise<void>;
  scenario(id: string): Promise<void>;
  requests(): readonly CapturedRequest[];
}
export const test = base.extend<{ api: LedgerApiFixture }>({
  api: async ({ page, context }, use) => {
    const state: FixtureState = {
      actor: "anonymous",
      session: null,
      scenarioId: "auth.anonymous",
      requests: [],
      values: new Map(),
    };
    const unhandled: string[] = [],
      errors: string[] = [],
      expectedHttpErrors = new Set<string>();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (
        message.text().startsWith("Failed to load resource:") &&
        expectedHttpErrors.has(message.location().url)
      )
        return;
      errors.push(message.text());
    });
    await context.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const captured: CapturedRequest = {
        method: request.method(),
        path: url.pathname.replace(/^\/api(?=\/|$)/, "") + url.search,
        body: request.postData(),
        idempotencyKey: request.headers()["idempotency-key"] ?? null,
        mfaCode: request.headers()["x-mfa-code"] ?? null,
      };
      state.requests.push(captured);
      const response =
        (await readScenario(state.scenarioId).handle(captured, state)) ??
        defaultAuthResponse(captured, state);
      if (!response) {
        unhandled.push(`${captured.method} ${captured.path}`);
        return route.abort();
      }
      const status = response.status ?? 200;
      if (status >= 400) expectedHttpErrors.add(url.href);
      if (response.delayMs)
        await new Promise((resolve) => setTimeout(resolve, response.delayMs));
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(
          response.error
            ? { success: false, error: response.error }
            : {
                success: true,
                data: response.data,
                requestId: "fixture-request",
                timestamp: "2026-10-23T00:00:00.000Z",
              },
        ),
      });
    });
    await use({
      useActor: async (actor) => {
        state.actor = actor;
        state.session = actorSession(actor);
      },
      scenario: async (id) => {
        const scenario = readScenario(id);
        state.scenarioId = id;
        state.values.clear();
        scenario.configure?.(state);
      },
      requests: () => state.requests,
    });
    expect(unhandled, "Unhandled Ledger API requests").toEqual([]);
    expect(errors, "Browser errors").toEqual([]);
  },
});
export { expect };
