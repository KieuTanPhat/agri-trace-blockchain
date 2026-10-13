import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  sid: string;
  email: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload & {
    organizationId: string | null;
    accountStatus: string;
  };
}
