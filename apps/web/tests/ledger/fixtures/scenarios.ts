import type { ActorKey, Session } from "./actors";
export type CapturedRequest = Readonly<{
  method: string;
  path: string;
  body: string | null;
  idempotencyKey: string | null;
}>;
export type FixtureResponse = {
  status?: number;
  data?: unknown;
  error?: { code: string; message: string };
  delayMs?: number;
};
export type FixtureState = {
  actor: ActorKey;
  session: Session | null;
  scenarioId: string;
  requests: CapturedRequest[];
  values: Map<string, unknown>;
};
export type Scenario = {
  configure?: (state: FixtureState) => void;
  handle: (
    request: CapturedRequest,
    state: FixtureState,
  ) => FixtureResponse | undefined | Promise<FixtureResponse | undefined>;
};
const scenarios = new Map<string, Scenario>();
export function registerScenario(id: string, scenario: Scenario) {
  if (scenarios.has(id)) throw new Error(`Duplicate scenario ${id}`);
  scenarios.set(id, scenario);
}
export function readScenario(id: string): Scenario {
  const scenario = scenarios.get(id);
  if (!scenario) throw new Error(`Unknown Ledger fixture scenario ${id}`);
  return scenario;
}
