import { describe, expect, it } from 'vitest';
import { businessRoleOf, effectiveRole } from './role-codes.js';

describe('Account roles', () => {
  it.each([
    ['FARM', 'FARM_STAFF'],
    ['TRANSPORTER', 'TRANSPORTER'],
    ['DISTRIBUTOR', 'DISTRIBUTOR'],
    ['PROCESSOR', 'PROCESSOR'],
    ['RETAILER', 'RETAILER'],
  ])('lets a %s employee act as %s', (type, role) => {
    for (const enterpriseTier of [2, 3]) {
      const user = {
        role: { code: 'ENTERPRISE_STAFF' },
        organization: { type },
        enterpriseTier,
      };
      expect(effectiveRole(user)).toBe(role);
      expect(businessRoleOf(user)).toBe(role);
    }
  });

  it('never derives a business role outside a delegated business member', () => {
    const staff = { role: { code: 'ENTERPRISE_STAFF' } };
    expect(effectiveRole({ ...staff, organization: { type: 'AUDITOR' }, enterpriseTier: 3 })).toBeNull();
    expect(effectiveRole({ ...staff, organization: { type: 'FARM' }, enterpriseTier: 1 })).toBeNull();
    expect(effectiveRole({ ...staff, organization: { type: 'FARM' }, enterpriseTier: null })).toBeNull();
    expect(effectiveRole({ ...staff, organization: null, enterpriseTier: 2 })).toBeNull();
  });

  it('keeps every other role as stored and exposes no business role for it', () => {
    for (const code of ['SYSTEM_ADMIN', 'AUDITOR', 'IOT_DEVICE', 'SYSTEM_ACTOR']) {
      const user = { role: { code }, organization: { type: 'FARM' }, enterpriseTier: 3 };
      expect(effectiveRole(user)).toBe(code);
      expect(businessRoleOf(user)).toBeNull();
    }
    expect(
      businessRoleOf({ role: { code: 'RETAILER' }, organization: { type: 'RETAILER' }, enterpriseTier: 1 }),
    ).toBe('RETAILER');
  });
});
