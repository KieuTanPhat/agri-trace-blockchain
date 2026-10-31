import { ApiError } from '../api/client';

export type Photo = { uri: string; name: string; type: string; file?: File };
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function assertPhotoFile(file: { size: number; type: string }) {
  if (!file.size) throw new ApiError(400, 'Ảnh trống hoặc không đọc được. Hãy chụp/chọn lại ảnh.');
  if (file.size > MAX_PHOTO_BYTES) throw new ApiError(400, 'Ảnh vượt 5 MB. Hãy chọn ảnh nhỏ hơn.');
  if (!['image/jpeg', 'image/png'].includes(file.type))
    throw new ApiError(400, 'Ảnh cần đúng định dạng JPG hoặc PNG. Hãy chụp/chọn lại ảnh.');
}
