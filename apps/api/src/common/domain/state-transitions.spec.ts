import {
  canTransition,
  cycleTransitions,
  shipmentTransitions,
} from './state-transitions.js';

describe('business state transitions', () => {
  it.each([
    ['CREATED', 'PLANTED'],
    ['PLANTED', 'GROWING'],
    ['GROWING', 'COMPLETED'],
  ])('allows cycle %s -> %s', (from, to) => {
    expect(canTransition(cycleTransitions, from, to)).toBe(true);
  });

  it.each([
    ['COMPLETED', 'GROWING'],
    ['CANCELLED', 'PLANTED'],
    ['CREATED', 'COMPLETED'],
  ])('rejects cycle %s -> %s', (from, to) => {
    expect(canTransition(cycleTransitions, from, to)).toBe(false);
  });

  it.each([
    ['CREATED', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'ARRIVED'],
    ['ARRIVED', 'DELIVERED'],
    ['ARRIVED', 'REJECTED'],
  ])('allows shipment %s -> %s', (from, to) => {
    expect(canTransition(shipmentTransitions, from, to)).toBe(true);
  });

  it.each([
    ['CREATED', 'DELIVERED'],
    ['IN_TRANSIT', 'DELIVERED'],
    ['DELIVERED', 'ARRIVED'],
  ])('rejects shipment %s -> %s', (from, to) => {
    expect(canTransition(shipmentTransitions, from, to)).toBe(false);
  });
});
