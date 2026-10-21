import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';

export const FIREBASE_CERT_FETCH = Symbol('FIREBASE_CERT_FETCH');
export type CertificateSet = {
  certificates: Record<string, string>;
  maxAgeSeconds: number;
};
export type FirebasePhoneProof = {
  tokenHash: string;
  proofKey: string;
  expiresAt: Date;
};
const unavailable = () =>
  new ServiceUnavailableException('Xác minh số điện thoại tạm chưa sẵn sàng');
const rejected = () =>
  new UnauthorizedException(
    'Xác nhận số điện thoại không hợp lệ hoặc đã hết hạn',
  );
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** Signature-only verification per Firebase's third-party JWT verification contract.
 * No Firebase private key is necessary. This is NOT a Firebase account-revocation check.
 * Local account/session status stays DB authoritative. Require recent auth_time,
 * not just iat: refreshing an old Firebase login cannot mint a new OTP proof.
 */
@Injectable()
export class FirebasePhoneVerifier {
  private cache?: CertificateSet & { until: number };
  private flight?: Promise<CertificateSet>;
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Optional()
    @Inject(FIREBASE_CERT_FETCH)
    private readonly certificateFetch?: () => Promise<CertificateSet>,
  ) {}
  private async certificates(): Promise<CertificateSet> {
    if (this.cache && this.cache.until > Date.now()) return this.cache;
    if (this.flight) return this.flight;
    this.flight = (async () => {
      try {
        const result = this.certificateFetch
          ? await this.certificateFetch()
          : await this.download();
        const entries = Object.entries(result.certificates);
        if (
          !entries.length ||
          entries.length > 10 ||
          entries.some(
            ([kid, cert]) =>
              !/^[a-zA-Z0-9_-]{1,128}$/.test(kid) ||
              typeof cert !== 'string' ||
              cert.length > 8192 ||
              !cert.startsWith('-----BEGIN CERTIFICATE-----'),
          )
        )
          throw unavailable();
        this.cache = {
          ...result,
          until:
            Date.now() +
            Math.max(0, Math.min(result.maxAgeSeconds, 3600)) * 1000,
        };
        return this.cache;
      } catch {
        throw unavailable();
      }
    })().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  private async download(): Promise<CertificateSet> {
    const response = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      },
    );
    if (!response.ok || !response.body) throw unavailable();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 65536) {
        await response.body.cancel().catch(() => undefined);
        throw unavailable();
      }
      chunks.push(chunk);
    }
    return {
      certificates: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      maxAgeSeconds: Number(
        /max-age=(\d+)/.exec(
          response.headers.get('cache-control') ?? '',
        )?.[1] ?? 0,
      ),
    };
  }
  async verify(token: string, phone: string): Promise<FirebasePhoneProof> {
    const project = this.config.get<string>('FIREBASE_PROJECT_ID');
    if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project))
      throw unavailable();
    let header: { alg?: string; kid?: string };
    try {
      if (token.length > 8192 || token.split('.').length !== 3)
        throw rejected();
      header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
      );
      if (header.alg !== 'RS256' || typeof header.kid !== 'string')
        throw rejected();
    } catch {
      throw rejected();
    }
    const keys = await this.certificates();
    const publicKey = Object.hasOwn(keys.certificates, header.kid!)
      ? keys.certificates[header.kid!]
      : undefined;
    if (!publicKey) throw rejected();
    try {
      const claims = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          // Explicit per-call key overrides the Nest module's API JWT secret.
          secret: publicKey,
          algorithms: ['RS256'],
          audience: project,
          issuer: `https://securetoken.google.com/${project}`,
        },
      );
      const now = Math.floor(Date.now() / 1000);
      const firebase = claims.firebase as
        { sign_in_provider?: string } | undefined;
      if (
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        claims.sub.length > 128 ||
        firebase?.sign_in_provider !== 'phone' ||
        claims.phone_number !== phone ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.auth_time) ||
        !Number.isInteger(claims.exp) ||
        (claims.iat as number) > now ||
        (claims.iat as number) < now - 300 ||
        (claims.auth_time as number) > (claims.iat as number) ||
        (claims.auth_time as number) < now - 300 ||
        (claims.exp as number) <= now
      )
        throw rejected();
      return {
        tokenHash: sha(token),
        proofKey: sha(`${project}\n${claims.sub}\n${claims.auth_time}`),
        expiresAt: new Date((claims.exp as number) * 1000),
      };
    } catch {
      throw rejected();
    }
  }
}
