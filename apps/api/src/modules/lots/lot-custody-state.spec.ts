import { describe, expect, it } from 'vitest';
import { lotStateMatchesShipment } from './lot-custody.js';

describe('lot state reconciliation', () => {
  it('accepts a lot a processing run used up completely', () => {
    expect(lotStateMatchesShipment({ currentState: 'CONSUMED', shipment: null })).toBe(true);
  });
  it('still rejects a state that needs a shipment when there is none', () => {
    expect(lotStateMatchesShipment({ currentState: 'IN_TRANSPORT', shipment: null })).toBe(false);
    expect(lotStateMatchesShipment({ currentState: 'CONSUMED', shipment: { status: 'IN_TRANSIT' } })).toBe(false);
  });
});
