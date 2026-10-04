import { AUTH_STORAGE_KEY, getProfile } from "./api-client";
import { apiBase } from "./workspace-api";
export type MediaFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  isPublic: boolean;
  targetType: string;
  targetId: string;
};
export function validateFile(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
      file.type,
    )
  )
    return "Chỉ hỗ trợ JPEG, PNG, WebP hoặc PDF.";
  if (!file.size || file.size > 5 * 1024 * 1024)
    return "Dung lượng tệp phải từ 1 byte đến 5 MB.";
  return "";
}
async function session() {
  await getProfile();
  const auth = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "null");
  if (!auth?.accessToken) throw new Error("Vui lòng đăng nhập lại");
  return auth;
}
export async function mediaBlob(id: string) {
  const auth = await session();
  const response = await fetch(apiBase + "/media/" + id + "/content", {
    headers: { authorization: "Bearer " + auth.accessToken },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "Bạn không có quyền xem tài liệu"
        : "Không tải được tài liệu hoặc tài liệu đã bị xóa",
    );
  if (
    JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "null")?.user?.id !==
    auth.user.id
  )
    throw new Error("Phiên đăng nhập đã thay đổi");
  return response.blob();
}
export async function uploadMedia(
  file: File,
  targetType: string,
  targetId: string,
  onProgress: (n: number) => void,
  idempotencyKey: string,
): Promise<MediaFile> {
  const invalid = validateFile(file);
  if (invalid) throw new Error(invalid);
  const auth = await session();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiBase + "/media");
    xhr.timeout = 120000;
    xhr.setRequestHeader("idempotency-key", idempotencyKey);
    xhr.setRequestHeader("authorization", "Bearer " + auth.accessToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error("Mất kết nối khi tải lên. Bạn có thể thử lại."));
    xhr.ontimeout = () =>
      reject(new Error("Tải lên quá thời gian. Bạn có thể thử lại."));
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("Máy chủ trả phản hồi không hợp lệ"));
        return;
      }
      if (
        JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "null")?.user
          ?.id !== auth.user.id
      ) {
        reject(new Error("Phiên đăng nhập đã thay đổi"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.data);
      else
        reject(
          new Error(
            data.error?.message ?? data.message ?? "Không tải được tệp",
          ),
        );
    };
    const body = new FormData();
    body.append("targetType", targetType);
    body.append("targetId", targetId);
    body.append("file", file);
    xhr.send(body);
  });
}
