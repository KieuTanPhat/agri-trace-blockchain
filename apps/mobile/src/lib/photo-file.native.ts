import { File } from 'expo-file-system';
import { ApiError } from '../api/client';
import { assertPhotoFile, type Photo } from './photo';

/** Expo 58 fetch serializes Blob/bytes(), not the legacy RN {uri} object. */
export function appendPhoto(form: FormData, photo: Photo) {
  let file: File;
  try {
    file = new File(photo.uri);
    if (!file.exists) throw new Error('Missing local photo');
  } catch {
    throw new ApiError(400, 'Không đọc được ảnh trên thiết bị. Hãy chụp/chọn lại ảnh.');
  }
  assertPhotoFile(file);
  form.append('file', file);
}
