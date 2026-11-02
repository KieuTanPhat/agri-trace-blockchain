import { errorText, newIdempotencyKey } from '../api/client';
import { commandIdentity, commandRecovery, type CommandOwner, type QueuedCommand } from './command-queue';
import { enqueue, removeQueued, updateQueued } from './queue';

type Command = Pick<QueuedCommand, 'path' | 'body' | 'label' | 'detail'>;
type Stored = Command & { key: string };
type Call = <T>(path: string, init: { body: unknown; idempotencyKey: string }) => Promise<T>;
type Inspection = { status: string; result?: unknown };
export type CommandOutcome =
  | { sent: true; result: unknown }
  | { sent: false; state: 'failed' | 'unknown'; error: string };

function rejectionMessage(result: unknown, fallback: string) {
  if (!result || typeof result !== 'object' || !('message' in result)) return fallback;
  const message = result.message;
  return typeof message === 'string' ? message
    : Array.isArray(message) && typeof message[0] === 'string' ? message[0] : fallback;
}

async function rememberInspection(
  owner: CommandOwner, command: Stored, inspected: Inspection, fallback: string,
): Promise<CommandOutcome> {
  const state = commandRecovery(inspected);
  if (state === 'committed') {
    await removeQueued(owner, command.key);
    return { sent: true, result: inspected.result };
  }
  const error = state === 'failed' ? rejectionMessage(inspected.result, fallback) : fallback;
  await updateQueued(owner, command.key, { state, error });
  return { sent: false, state, error };
}

function inspect(call: Call, command: Stored) {
  return call<Inspection>('/command-requests/status', {
    body: commandIdentity(command), idempotencyKey: command.key,
  });
}

async function transmit(call: Call, owner: CommandOwner, command: Stored): Promise<CommandOutcome> {
  try {
    const result = await call(command.path, { body: command.body, idempotencyKey: command.key });
    await removeQueued(owner, command.key);
    return { sent: true, result };
  } catch (error) {
    const message = errorText(error);
    try {
      return await rememberInspection(owner, command, await inspect(call, command), message);
    } catch {
      await updateQueued(owner, command.key, { state: 'unknown', error: message });
      return { sent: false, state: 'unknown', error: message };
    }
  }
}

/** Persist the original body/key before sending. Rejection needs positive journal evidence. */
export async function sendCommand(call: Call, owner: CommandOwner, command: Command) {
  const stored = { ...command, key: newIdempotencyKey() };
  await enqueue(owner, stored);
  return transmit(call, owner, stored);
}

/** An unknown or processing command is inspected only; only NOT_FOUND permits transmission. */
export async function retryCommand(call: Call, owner: CommandOwner, command: QueuedCommand): Promise<CommandOutcome> {
  if (command.ownerId !== owner.id || command.organizationId !== (owner.organizationId ?? null))
    throw new Error('Lệnh không thuộc tài khoản đang đăng nhập.');
  try {
    const inspected = await inspect(call, command);
    if (inspected.status === 'NOT_FOUND') return await transmit(call, owner, command);
    return await rememberInspection(owner, command, inspected,
      'Máy chủ chưa xác nhận kết quả. Giữ nguyên lệnh và đối soát lại sau.');
  } catch (error) {
    const message = errorText(error);
    await updateQueued(owner, command.key, { state: 'unknown', error: message });
    return { sent: false, state: 'unknown', error: message };
  }
}
