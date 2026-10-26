import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { newIdempotencyKey, errorText } from "../api/client";
import {
  enqueue,
  removeQueued,
  updateQueued,
  type CommandOwner,
} from "./queue";
import { commandIdentity, commandRecovery } from "./command-queue";

type Call = <T>(
  path: string,
  init?: { body?: unknown; form?: FormData; idempotencyKey?: string },
) => Promise<T>;

export type Photo = { uri: string; name: string; type: string; file?: File };

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
  if (Platform.OS === "web" && photo.file)
    form.append("file", photo.file, photo.name);
  else
    form.append("file", {
      uri: photo.uri,
      name: photo.name,
      type: photo.type,
    } as unknown as Blob);
  const result = await call<{ record: { id: string } }>(
    "/enterprise-workspace/evidence",
    { form, idempotencyKey: newIdempotencyKey() },
  );
  return result.record.id;
}

/**
 * Sends a business command once. Without a connection it is queued with the
 * same key; an answer lost mid-flight is queued as "unknown" and re-asked
 * with that key, never re-created under a new one.
 */
export async function sendCommand(
  call: Call,
  owner: CommandOwner,
  command: { path: string; body: object; label: string; detail: string },
) {
  const key = newIdempotencyKey();
  await enqueue(owner, { ...command, key });
  try {
    const result = await call(command.path, {
      body: command.body,
      idempotencyKey: key,
    });
    await removeQueued(owner, key);
    return { sent: true as const, result };
  } catch (error) {
    try {
      const inspected = await call<{ status: string; result?: unknown }>(
        "/command-requests/status",
        { body: commandIdentity(command), idempotencyKey: key },
      );
      const status = commandRecovery(inspected);
      if (status === "committed") {
        await removeQueued(owner, key);
        return { sent: true as const, result: inspected.result };
      }
      await updateQueued(owner, key, {
        state: status === "failed" ? "failed" : "unknown",
        error: errorText(error),
      });
    } catch {
      await updateQueued(owner, key, {
        state: "unknown",
        error: errorText(error),
      });
    }
    return { sent: false as const };
  }
}
