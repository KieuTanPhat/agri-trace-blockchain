import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSubmission } from '../../mobile/src/lib/use-submission';

afterEach(cleanup);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('Staff form submission', () => {
  it('ignores simultaneous taps and remains locked after a sent or queued result', async () => {
    const upload = deferred();
    const task = vi.fn(() => upload.promise);
    const { result } = renderHook(useSubmission);
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.run(task);
      await result.current.run(task);
    });
    expect(task).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => { upload.resolve(); await first; });
    await act(() => result.current.run(task));
    expect(task).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });
  it('shows an upload error and allows an explicit retry', async () => {
    const { result } = renderHook(useSubmission);
    await act(() => result.current.run(async () => { throw new Error('Upload refused'); }));
    expect(result.current.error).toBe('Đã có lỗi xảy ra. Vui lòng thử lại.');
    const retry = vi.fn(async () => undefined);
    await act(() => result.current.run(retry));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
  it('does not issue a command after its form was removed during an image upload', async () => {
    const upload = deferred();
    const command = vi.fn();
    const { result, unmount } = renderHook(useSubmission);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run(async (isCurrent) => {
        await upload.promise;
        if (!isCurrent()) return;
        command();
      });
    });
    unmount();
    await act(async () => { upload.resolve(); await pending; });
    expect(command).not.toHaveBeenCalled();
  });
  it('keeps a newly mounted form independent of the previous account request', async () => {
    const oldUpload = deferred();
    const old = renderHook(useSubmission);
    let pending!: Promise<void>;
    act(() => {
      pending = old.result.current.run(async () => {
        await oldUpload.promise;
        throw new Error('Old account error');
      });
    });
    old.unmount();
    const next = renderHook(useSubmission);
    await act(async () => { oldUpload.resolve(); await pending; });
    await waitFor(() => expect(next.result.current.error).toBeNull());
    const submit = vi.fn(async () => undefined);
    await act(() => next.result.current.run(submit));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
