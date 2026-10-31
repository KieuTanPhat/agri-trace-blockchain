import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertFormDataAsync } from '../../../mobile/node_modules/expo/build/winter/fetch/convertFormData';
const state = vi.hoisted(() => ({ exists: true, size: 4, type: 'image/jpeg' }));
vi.mock('../../../mobile/node_modules/expo-file-system', () => ({
  File: class {
    readonly name = 'camera.jpg';
    readonly exists = state.exists;
    readonly size = state.size;
    readonly type = state.type;
    async bytes() { return new Uint8Array([255, 216, 255, 219]); }
  },
}));
import { appendPhoto as appendNative } from '../../../mobile/src/lib/photo-file.native';
import { appendPhoto as appendWeb } from '../../../mobile/src/lib/photo-file';
import { MAX_PHOTO_BYTES, type Photo } from '../../../mobile/src/lib/photo';

// Expo patches RN FormData to expose these entries. Keep native file objects
// intact instead of JSDOM's browser-only string coercion, then use the real SDK serializer.
class DeviceFormData {
  parts: [string, unknown][] = [];
  append(name: string, value: unknown) { this.parts.push([name, value]); }
  entries() { return this.parts.values(); }
}
const photo: Photo = { uri: 'file:///cache/camera.jpg', name: 'camera.jpg', type: 'image/jpeg' };
const form = () => new DeviceFormData() as unknown as FormData;
afterEach(() => { vi.unstubAllGlobals(); Object.assign(state, { exists: true, size: 4, type: 'image/jpeg' }); });

describe('Expo 58 multipart photos', () => {
  it('reproduces the legacy URI object failure before any HTTP request', async () => {
    const body = form(); body.append('file', photo as unknown as Blob);
    await expect(convertFormDataAsync(body, 'fixture-boundary')).rejects.toThrow('Unsupported FormDataPart implementation');
  });
  it('serializes native File bytes and metadata with the installed Expo converter', async () => {
    const body = form(); body.append('entityType', 'CYCLE'); body.append('entityId', 'cycle-fixture');
    appendNative(body, photo);
    const result = await convertFormDataAsync(body, 'fixture-boundary');
    const wire = new TextDecoder().decode(result.body);
    expect(wire).toContain('filename="camera.jpg"');
    expect(wire).toContain('content-type: image/jpeg');
    expect(wire).toContain('cycle-fixture');
    expect(Buffer.from(result.body).includes(Buffer.from([255, 216, 255, 219]))).toBe(true);
    expect(wire).not.toContain('[object Object]');
  });
  it('rejects missing local files with an actionable message', () => {
    state.exists = false;
    expect(() => appendNative(form(), photo)).toThrow('Không đọc được ảnh trên thiết bị');
  });
  it.each([{ size: 0, type: 'image/jpeg' }, { size: MAX_PHOTO_BYTES + 1, type: 'image/jpeg' }, { size: 4, type: 'image/heic' }])('rejects invalid file metadata before transport ($size/$type)', (input) => {
    Object.assign(state, input); const body = form();
    expect(() => appendNative(body, photo)).toThrow();
    expect([...body.entries()]).toHaveLength(0);
  });
  it('keeps the original browser File for web preview', () => {
    const file = new File(['jpeg'], 'browser.jpg', { type: 'image/jpeg' }); const body = form();
    appendWeb(body, { ...photo, file });
    expect([...body.entries()][0][1]).toBe(file);
  });
});
