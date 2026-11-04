import { useRef, useState } from 'react';
import { errorText, type Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { sendCommand } from './staff-command';

type CommandMessage = { kind: 'success' | 'error' | 'warn'; text: string };
type Command = { path: string; label: string; detail: string; body: object };

/**
 * Sends one journaled command at a time and reports the outcome in words.
 * `prepare` runs first (photo uploads); a lost answer keeps the command in the
 * queue for reconciliation with its original key.
 */
export function useCommand() {
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<CommandMessage | null>(null);
  const locked = useRef(false);
  async function send(build: () => Promise<Command> | Command, done: string) {
    if (!user || locked.current) return false;
    locked.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await sendCommand(call, user, await build());
      if (outcome.sent) {
        setMessage({ kind: 'success', text: done });
        return true;
      }
      setMessage({ kind: outcome.state === 'failed' ? 'error' : 'warn', text: outcome.state === 'failed' ? outcome.error : `${outcome.error} Lệnh được giữ trong mục Lệnh chờ gửi.` });
      return false;
    } catch (cause) {
      setMessage({ kind: 'error', text: errorText(cause) });
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { send, busy, message, setMessage };
}

const DEC = /^\d{1,11}(\.\d{1,3})?$/;

/** A positive decimal no larger than `max` (when known); null when valid. */
export function quantityError(value: string, max?: string | number | null) {
  if (!DEC.test(value) || Number(value) <= 0) return 'Nhập số lớn hơn 0, tối đa 3 chữ số thập phân.';
  if (max !== undefined && max !== null && Number(value) > Number(max)) return `Vượt lượng khả dụng (tối đa ${max}).`;
  return null;
}
