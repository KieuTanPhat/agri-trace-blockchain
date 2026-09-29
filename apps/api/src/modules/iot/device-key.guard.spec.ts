import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceKeyGuard } from './device-key.guard.js';

describe('DeviceKeyGuard byte comparison', () => {
  const guard = new DeviceKeyGuard({
    get: () => 'ab',
  } as unknown as ConfigService);
  const context = (key: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ header: () => key }) }),
    }) as ExecutionContext;

  it('accepts the configured key', () => {
    expect(guard.canActivate(context('ab'))).toBe(true);
  });
  it.each(['wrong', '', '\u00e9a'])(
    'rejects invalid keys without a buffer-length crash: %s',
    (key) => {
      expect(() => guard.canActivate(context(key))).toThrow(
        UnauthorizedException,
      );
    },
  );
});
