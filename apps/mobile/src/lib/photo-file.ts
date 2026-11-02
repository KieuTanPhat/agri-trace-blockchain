import { ApiError } from '../api/client';
import { assertPhotoFile, type Photo } from './photo';

/** Browser preview uses the actual File returned by the picker. */
export function appendPhoto(form: FormData, photo: Photo) {
  if (!photo.file) throw new ApiError(400, 'Không đọc được ảnh đã chọn. Hãy chọn lại ảnh.');
  assertPhotoFile(photo.file);
  form.append('file', photo.file, photo.name);
}
