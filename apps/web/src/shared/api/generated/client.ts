// Generated from docs/openapi/openapi.json; version 2.1.0; SHA-256 9e4f1cc08c2c35c52b3124d19d89c1dae1c8be290784be6bbec03716500abc9f. Do not edit.
import type { operations } from "./api";

export type ContractTransport = <T>(path: string, init?: RequestInit, authenticated?: boolean) => Promise<T>;

export function createContractClient(transport: ContractTransport) {
  return {
    login(body: operations["AuthController_login"]["requestBody"]["content"]["application/json"], init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["AuthController_login"]["responses"][201]["content"]["application/json"]["data"]> {
      return transport(`/auth/login`, { ...init, method: "POST", body: JSON.stringify(body) }, false);
    },
    getLots(init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["LotsController_getLots"]["responses"][200]["content"]["application/json"]["data"]> {
      return transport(`/lots`, { ...init, method: "GET" }, true);
    },
    getLot(path: operations["LotsController_getLot"]["parameters"]["path"], init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["LotsController_getLot"]["responses"][200]["content"]["application/json"]["data"]> {
      return transport(`/lots/${encodeURIComponent(String(path["lotId"]))}`, { ...init, method: "GET" }, true);
    },
    getCatalog(init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["CatalogController_list"]["responses"][200]["content"]["application/json"]["data"]> {
      return transport(`/catalog`, { ...init, method: "GET" }, true);
    },
    getOrganizations(init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["OrganizationsController_list"]["responses"][200]["content"]["application/json"]["data"]> {
      return transport(`/organizations`, { ...init, method: "GET" }, true);
    },
    getPublicTrace(path: operations["PublicTraceController_get"]["parameters"]["path"], init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["PublicTraceController_get"]["responses"][200]["content"]["application/json"]["data"]> {
      return transport(`/public/trace/${encodeURIComponent(String(path["token"]))}`, { ...init, method: "GET" }, false);
    },
    recordHarvest(path: operations["LotsController_harvest"]["parameters"]["path"], body: operations["LotsController_harvest"]["requestBody"]["content"]["application/json"], init: Omit<RequestInit, "method" | "body"> = {}): Promise<operations["LotsController_harvest"]["responses"][201]["content"]["application/json"]["data"]> {
      return transport(`/production-cycles/${encodeURIComponent(String(path["cycleId"]))}/harvests`, { ...init, method: "POST", body: JSON.stringify(body) }, true);
    },
  };
}
