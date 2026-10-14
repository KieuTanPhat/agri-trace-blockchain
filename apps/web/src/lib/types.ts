import type { components } from "../shared/api/generated/api";
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
  accessRevision?: string;
  productionAccess?: boolean;
};
export type LoginResponse = Pick<
  Schemas["AuthSessionDto"],
  "accessToken" | "tokenType"
> & { user: AuthUser };
// Form state shared by several commands, not a wire DTO. Endpoint payloads
// belong to the generated contract; optional fields represent unfilled inputs.
export type CommandInput = Partial<Pick<
  Schemas["CreateShipmentDto"] & Schemas["DamageShipmentDto"] & Schemas["ReceiveShipmentDto"],
  "transporterOrgId" | "retailerOrgId" | "origin" | "destination" |
  "quantity" | "reason" | "evidenceRef" | "receivedQuantity" | "damagedQuantity" | "note"
>>;
export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
};
export type SensorReadingRequest = Schemas["IngestSensorReadingDto"];
export type SensorReadingResponse =
  Schemas["ReadingAcceptedDto"] | { status: "rejected"; error: ApiError };
