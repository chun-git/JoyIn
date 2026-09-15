import { describe, expect, it } from 'vitest';
import { resolvePreorderCapabilities } from '../src/services/preorders';

describe('resolvePreorderCapabilities', () => {
  it('grants create/order to confirmed SELF regardless of organizer/provider', () => {
    const caps = resolvePreorderCapabilities({
      ended: false,
      selfStatus: 'CONFIRMED',
      offerStatus: 'OPEN',
      orderDeadline: new Date(Date.now() + 60_000).toISOString(),
      isProvider: false,
    });
    expect(caps.canCreatePreorder).toBe(true);
    expect(caps.canOrder).toBe(true);
    expect(caps.canManagePreorder).toBe(false);
    expect(caps.preorderRestrictionReason).toBeNull();
    expect(caps.orderRestrictionReason).toBeNull();
  });

  it('separates manage from order for provider', () => {
    const caps = resolvePreorderCapabilities({
      ended: false,
      selfStatus: 'CONFIRMED',
      offerStatus: 'OPEN',
      orderDeadline: new Date(Date.now() + 60_000).toISOString(),
      isProvider: true,
    });
    expect(caps.canManagePreorder).toBe(true);
    expect(caps.canOrder).toBe(true);
  });

  it('blocks waitlist and unregistered with explicit reasons', () => {
    expect(
      resolvePreorderCapabilities({
        ended: false,
        selfStatus: 'WAITLIST',
        isProvider: false,
      }).preorderRestrictionReason,
    ).toContain('候補');

    expect(
      resolvePreorderCapabilities({
        ended: false,
        selfStatus: null,
        isProvider: false,
      }).orderRestrictionReason,
    ).toContain('尚未報名');
  });
});
