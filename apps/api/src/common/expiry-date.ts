import { UnprocessableEntityException } from '@nestjs/common';

const vietnamDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function normalizeExpiryDate(value: string): Date {
  const calendarOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!calendarOnly && !/(Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new UnprocessableEntityException(
      'Ngày hết hạn cần YYYY-MM-DD hoặc datetime có múi giờ',
    );
  const instant = new Date(calendarOnly ? `${value}T00:00:00.000Z` : value);
  if (
    !Number.isFinite(instant.getTime()) ||
    (calendarOnly && instant.toISOString().slice(0, 10) !== value)
  )
    throw new UnprocessableEntityException('Ngày hết hạn không hợp lệ');
  const date = calendarOnly ? value : vietnamDate.format(instant);
  return new Date(`${date}T00:00:00.000Z`);
}

/** Prisma Date columns represent a calendar date at UTC midnight. */
export function isPastExpiry(
  expiryDate: Date | null | undefined,
  now = new Date(),
): boolean {
  return (
    !!expiryDate &&
    vietnamDate.format(now) > expiryDate.toISOString().slice(0, 10)
  );
}
