export const cycleTransitions = {
  CREATED: ['PLANTED', 'CANCELLED'],
  PLANTED: ['GROWING', 'COMPLETED', 'CANCELLED'],
  GROWING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
} as const;

export const shipmentTransitions = {
  CREATED: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['ARRIVED', 'FAILED'],
  ARRIVED: ['DELIVERED', 'REJECTED', 'FAILED'],
  DELIVERED: [],
  REJECTED: [],
  FAILED: [],
} as const;

export function canTransition(
  transitions: Record<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}
