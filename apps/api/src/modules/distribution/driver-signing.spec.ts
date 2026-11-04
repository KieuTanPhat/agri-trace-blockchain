import { driverMaySign } from './distribution.service.js';

describe('driverMaySign', () => {
  const carrier = 'org-sender';
  const t = { carrierId: carrier, driverUserId: 'driver' };
  const actor = (sub: string, organizationId = carrier) => ({ sub, organizationId, role: 'ENTERPRISE_STAFF' });

  it('lets only the named driver or the owner sign pickup and delivery for the carrying side', () => {
    for (const phase of ['PICKUP', 'DELIVERY']) {
      expect(driverMaySign(t, phase, actor('driver'), false)).toBe(true);
      expect(driverMaySign(t, phase, actor('owner'), true)).toBe(true);
      expect(driverMaySign(t, phase, actor('warehouse'), false)).toBe(false);
    }
  });

  it('keeps consent, the receiver and driverless transfers organization-level', () => {
    expect(driverMaySign(t, 'CONSENT', actor('warehouse'), false)).toBe(true);
    expect(driverMaySign(t, 'DELIVERY', actor('receiver-staff', 'org-receiver'), false)).toBe(true);
    expect(driverMaySign({ carrierId: carrier, driverUserId: null }, 'PICKUP', actor('warehouse'), false)).toBe(true);
  });
});
