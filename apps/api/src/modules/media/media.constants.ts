export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

export interface UploadedMediaFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
