import { afterEach, describe, expect, it, vi } from 'vitest';
import { enforcePasswordAge, passwordExpired } from './password-age.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-20T12:00:00Z');
const user = (changedDaysAgo: number | null, createdDaysAgo = 400) => ({
  id: 'u1',
  mustChangePassword: false,
  role: { code: 'FARM_STAFF' },
  createdAt: new Date(now - createdDaysAgo * DAY),
  passwordChangedAt:
    changedDaysAgo === null ? null : new Date(now - changedDaysAgo * DAY),
});

describe('password age', () => {
  afterEach(() => {
    delete process.env.PASSWORD_MAX_AGE_DAYS;
    vi.useRealTimers();
  });

  it('expires a password 30 days after its last change by default', () => {
    expect(passwordExpired(user(29), now)).toBe(false);
    expect(passwordExpired(user(30), now)).toBe(true);
  });

  it('ages a never-changed password from account creation', () => {
    expect(passwordExpired(user(null, 10), now)).toBe(false);
    expect(passwordExpired(user(null, 31), now)).toBe(true);
  });

  it('exempts machine identities and can be disabled', () => {
    expect(
      passwordExpired({ ...user(90), role: { code: 'IOT_DEVICE' } }, now),
    ).toBe(false);
    process.env.PASSWORD_MAX_AGE_DAYS = '0';
    expect(passwordExpired(user(90), now)).toBe(false);
  });

  it('flags only an expired account that is not already forced', async () => {
    vi.useFakeTimers({ now });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { user: { updateMany } } as never;
    expect(await enforcePasswordAge(db, user(5))).toBe(false);
    expect(
      await enforcePasswordAge(db, { ...user(60), mustChangePassword: true }),
    ).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(await enforcePasswordAge(db, user(60))).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', mustChangePassword: false },
      data: { mustChangePassword: true },
    });
  });
});
