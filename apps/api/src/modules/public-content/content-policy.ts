import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
type Kind = 'news' | 'announcements';
export function contentCursor(kind: Kind, id: string, time: Date) {
  return Buffer.from(
    JSON.stringify({ kind, id, time: time.toISOString() }),
  ).toString('base64url');
}
export function parseContentCursor(
  kind: Kind,
  cursor?: string,
): { id: string; time: Date } | null {
  if (cursor === undefined) return null;
  try {
    if (!cursor || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !raw ||
      raw.kind !== kind ||
      typeof raw.id !== 'string' ||
      !isUUID(raw.id) ||
      typeof raw.time !== 'string'
    )
      throw new Error();
    const time = new Date(raw.time);
    if (
      time.toISOString() !== raw.time ||
      contentCursor(kind, raw.id, time) !== cursor
    )
      throw new Error();
    return { id: raw.id, time };
  } catch {
    throw new BadRequestException('Cursor chưa hợp lệ.');
  }
}
export function contentLimit(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new BadRequestException('limit phải từ 1 đến 50');
  return limit;
}
export function allowedCover(
  value: string | null,
  configured: string | undefined,
): string | null {
  if (!value || !configured) return null;
  try {
    const url = new URL(value);
    const hosts = configured
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      hosts.includes(url.hostname.toLowerCase())
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export const literalSearch = (q?: string) =>
  q?.trim().replace(/[\\%_]/g, '\\$&');
