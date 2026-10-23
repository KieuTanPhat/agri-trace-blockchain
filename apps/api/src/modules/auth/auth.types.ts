import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  sid: string;
  email: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload & {
    enterpriseScope?: {
      chainIds: string[];
      farmIds: string[];
      distributionChainIds?: string[];
      roleScopes: Array<{
        chainIds: string[];
        siteIds: string[];
        permissions: string[];
      }>;
    };
    organizationId: string | null;
    accountStatus: string;
  };
}
