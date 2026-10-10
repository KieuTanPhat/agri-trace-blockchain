import { UnprocessableEntityException } from '@nestjs/common';

/** Accept an explicit instant; Date alone silently normalizes invalid dates. */
export function businessTimestamp(
  value: string,
  field: string,
  options: { notBefore?: Date; allowFuture?: boolean; now?: Date } = {},
): Date {
  const match =
    /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match)
    throw new UnprocessableEntityException(
      `${field} cần datetime có múi giờ và độ chính xác tối đa mili giây`,
    );
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    ,
    ,
    ,
    offsetHour,
    offsetMinute,
  ] = match;
  const calendar = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  const invalid =
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() + 1 !== Number(month) ||
    calendar.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour ?? 0) > 14 ||
    Number(offsetMinute ?? 0) > 59 ||
    (Number(offsetHour ?? 0) === 14 && Number(offsetMinute ?? 0) !== 0);
  const instant = new Date(value);
  const now = options.now ?? new Date();
  if (
    invalid ||
    !Number.isFinite(instant.getTime()) ||
    (!options.allowFuture && instant > now) ||
    (options.notBefore && instant < options.notBefore)
  )
    throw new UnprocessableEntityException(
      `${field} không hợp lệ, ở tương lai hoặc trước mốc nghiệp vụ trước đó`,
    );
  return instant;
}
