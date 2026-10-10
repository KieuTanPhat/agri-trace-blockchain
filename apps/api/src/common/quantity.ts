import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

const MAX_QUANTITY = new Prisma.Decimal('99999999999.999');

export function quantity(
  value: string | number | Prisma.Decimal,
  allowZero = false,
): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
  } catch {
    throw new UnprocessableEntityException('Số lượng không hợp lệ');
  }
  if (
    !parsed.isFinite() ||
    parsed.decimalPlaces() > 3 ||
    parsed.greaterThan(MAX_QUANTITY) ||
    (allowZero ? parsed.isNegative() : !parsed.greaterThan(0))
  )
    throw new UnprocessableEntityException(
      'Số lượng phải hợp lệ, tối đa 3 số lẻ và không vượt giới hạn',
    );
  return parsed;
}

export async function quantityIsReconciled(
  db: Prisma.TransactionClient,
  lot: {
    id: string;
    initialQuantity: Prisma.Decimal;
    availableQuantity: Prisma.Decimal;
    unit: string;
  },
): Promise<boolean> {
  const movements = await db.quantityMovement.findMany({
    where: { lotId: lot.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return reconcileQuantityMovements(lot, movements);
}

export function reconcileQuantityMovements(
  lot: {
    initialQuantity: Prisma.Decimal;
    availableQuantity: Prisma.Decimal;
    unit: string;
  },
  movements: Array<{
    type: string;
    quantity: Prisma.Decimal;
    unit: string;
    beforeQty: Prisma.Decimal;
    delta: Prisma.Decimal;
    afterQty: Prisma.Decimal;
  }>,
): boolean {
  const harvests = movements.filter(
    (movement) => movement.type === 'HARVEST_IN',
  );
  if (
    harvests.length !== 1 ||
    !harvests[0].beforeQty.isZero() ||
    !harvests[0].delta.equals(lot.initialQuantity) ||
    !harvests[0].afterQty.equals(lot.initialQuantity)
  )
    return false;
  let balance = lot.initialQuantity;
  for (const movement of movements) {
    if (
      movement.unit !== lot.unit ||
      !movement.quantity.greaterThan(0) ||
      movement.beforeQty.isNegative() ||
      movement.afterQty.isNegative() ||
      !movement.beforeQty.add(movement.delta).equals(movement.afterQty) ||
      !movement.quantity.equals(movement.delta.abs())
    )
      return false;
  }
  const outflows = movements
    .filter((movement) => movement.type !== 'HARVEST_IN')
    .sort((a, b) => b.beforeQty.comparedTo(a.beforeQty));
  for (const movement of outflows) {
    if (
      !['DAMAGE_OUT', 'SALE_OUT', 'EXPIRE_OUT', 'RECALL_OUT'].includes(
        movement.type,
      ) ||
      !movement.delta.isNegative() ||
      !movement.beforeQty.equals(balance)
    )
      return false;
    balance = movement.afterQty;
  }
  return (
    !lot.availableQuantity.isNegative() && balance.equals(lot.availableQuantity)
  );
}

export async function assertQuantityReconciled(
  db: Prisma.TransactionClient,
  lot: {
    id: string;
    initialQuantity: Prisma.Decimal;
    availableQuantity: Prisma.Decimal;
    unit: string;
  },
): Promise<void> {
  if (!(await quantityIsReconciled(db, lot)))
    throw new ConflictException(
      'Sổ lượng không khớp tồn; cần đối soát trước khi ghi tiếp',
    );
}
