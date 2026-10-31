import * as ImagePicker from "expo-image-picker";
import { appendPhoto } from "./photo-file";
import type { Photo } from "./photo";
import { newIdempotencyKey } from "../api/client";
export { sendCommand } from "./staff-command";

export type { Photo } from "./photo";

type Call = <T>(
  path: string,
  init?: { body?: unknown; form?: FormData; idempotencyKey?: string },
) => Promise<T>;

/** Camera first; the library is the fallback (web preview, denied camera). */
export async function takePhoto(
  source: "camera" | "library",
): Promise<Photo | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 0.6,
    allowsEditing: false,
    exif: false,
  };
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const type = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
  return {
    uri: asset.uri,
    name:
      asset.fileName ??
      `anh-${Date.now()}.${type === "image/png" ? "png" : "jpg"}`,
    type,
    file: asset.file ?? undefined,
  };
}

/** Uploads one private image as cycle evidence and returns its id. */
export async function uploadCycleImage(
  call: Call,
  cycleId: string,
  photo: Photo,
  kind: "HARVEST_IMAGE" | "LOT_IMAGE" | "CARE_IMAGE",
  description: string,
) {
  const form = new FormData();
  form.append("entityType", "CYCLE");
  form.append("entityId", cycleId);
  form.append("kind", kind);
  form.append("description", description);
  appendPhoto(form, photo);
  const result = await call<{ record: { id: string } }>(
    "/enterprise-workspace/evidence",
    { form, idempotencyKey: newIdempotencyKey() },
  );
  return result.record.id;
}
