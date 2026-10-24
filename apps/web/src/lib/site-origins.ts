import { getTracePath } from "./trace-input";

function origin(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Site origins require HTTPS (or local HTTP), without credentials, path or query");
  return url.origin;
}
export function readSiteOrigins() {
  const business = process.env.NEXT_PUBLIC_BUSINESS_ORIGIN ?? "";
  const customer = process.env.NEXT_PUBLIC_CUSTOMER_ORIGIN ?? "";
  if (!business && !customer) return null;
  if (!business || !customer) throw new Error("Both business and customer origins are required");
  const pair = { business: origin(business), customer: origin(customer) };
  if (pair.business === pair.customer) throw new Error("Site origins must be distinct");
  return pair;
}
function target(base: string, path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("Expected a local path");
  const url = new URL(path, base);
  if (url.origin !== base) throw new Error("Expected a local path");
  return url;
}
export function businessHref(path: string) {
  const pair = readSiteOrigins();
  return pair ? target(pair.business, path).href : path;
}
export function customerHref(path: string) {
  const pair = readSiteOrigins();
  return pair ? target(pair.customer, path).href : path;
}
export function publicTraceUrl(token: string, fallbackOrigin = "") {
  const path = getTracePath(token);
  if (!path) throw new Error("Invalid trace token");
  const pair = readSiteOrigins();
  return pair ? target(pair.customer, path).href : `${fallbackOrigin}${path}`;
}
/** Customer-site pages besides `/` and trace; they never need a business session. */
export const CUSTOMER_PAGES = ["/scan", "/about", "/solutions", "/contact"] as const;
export function isCustomerPage(path: string) {
  return CUSTOMER_PAGES.some((page) => path === page);
}
/** Only configured hostnames participate; API, assets and legal pages stay on their origin. */
export function siteRedirect(input: URL): URL | null {
  const pair = readSiteOrigins();
  if (!pair) return null;
  const businessHost = new URL(pair.business).host, customerHost = new URL(pair.customer).host;
  const host = input.host.replace(/^www\./, "");
  if (![businessHost, customerHost].includes(host)) return null;
  const path = input.pathname;
  if (/^\/(?:api|_next|brand)(?:\/|$)/.test(path) || /\.[a-z0-9]+$/i.test(path) || ["/terms", "/privacy"].includes(path)) return null;
  const publicPage = path === "/" || path === "/trace" || path.startsWith("/trace/") || isCustomerPage(path);
  let destination: URL | null = null;
  if (host === customerHost && !publicPage) destination = target(pair.business, path);
  if (host === businessHost && publicPage) destination = target(path === "/" ? pair.business : pair.customer, path === "/" ? "/login" : path);
  if (destination) destination.search = input.search;
  return destination;
}
