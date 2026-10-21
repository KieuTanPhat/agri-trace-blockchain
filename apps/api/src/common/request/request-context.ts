import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request values that deep service code (for example the platform audit
 * writer) needs without threading them through every signature. */
export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
