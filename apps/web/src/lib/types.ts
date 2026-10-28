import type { components } from "./generated/api";
type Schemas = components["schemas"];
export type Role = Schemas["AuthRoleDto"]["code"];
export type AllowedCommand =
  Schemas["InternalLotDto"]["allowedCommands"][number];
export type ProofStatus = Schemas["InternalLotDto"]["proofStatus"];
export type Organization = Schemas["OrganizationSummaryDto"];
export type TraceEvent = Schemas["InternalTimelineDto"];
export type LotTrace = Schemas["InternalLotDto"];
export type PublicLotTrace = Schemas["PublicLotDto"];
export type Dashboard = Schemas["DashboardDto"];
export type ProductionCycleOption = Schemas["CycleListDto"];
// The browser session consumes this subset of the generated auth contract.
export type AuthUser = Pick<
  Schemas["AuthUserDto"],
  "id" | "email" | "fullName" | "organizationId" | "accountStatus"
> & {
  role: Pick<Schemas["AuthRoleDto"], "code" | "name">;
  /** True while the account only has a temporary password. */
  mustChangePassword?: boolean;
  accessRevision?: string;
  productionAccess?: boolean;
};
export type LoginResponse = Pick<
  Schemas["AuthSessionDto"],
  "accessToken" | "tokenType"
> & { user: AuthUser };
export type CommandInput = {
  transporterOrgId?: string;
  retailerOrgId?: string;
  origin?: string;
  destination?: string;
  quantity?: number;
  reason?: string;
  evidenceRef?: string;
  receivedQuantity?: number;
  damagedQuantity?: number;
  note?: string;
};
export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
};
export type SensorReadingRequest = Schemas["IngestSensorReadingDto"];
export type SensorReadingResponse =
  Schemas["ReadingAcceptedDto"] | { status: "rejected"; error: ApiError };
